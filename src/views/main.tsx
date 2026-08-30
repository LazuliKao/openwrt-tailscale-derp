import { captureExpectedStatus, clearPendingStatus, savePendingStatus, validateSocketAddress, validateUnixSocketPath } from "@/shared/config";
import { callExternalStatus, type ExternalStatus } from "@/shared/external";
import { copyText } from "@/shared/utils";

type ReloadConfigResponse = Record<string, never>;
type FormMap = LuCI.form.Map;
type FormOption = any;

const view = L.view;
const form = L.form;
const rpc = L.rpc;
const ui = L.ui;
const uci = L.uci;

const callReloadConfig = rpc.declare<ReloadConfigResponse>({
  object: "luci.tailscale-derp",
  method: "reload_config",
});

function validateMeshKey(this: FormOption, sectionId: string, value: any): true | string {
  const enabled = this.section.formvalue(sectionId, "enabled");

  if ((enabled === "1" || enabled === true) && !value) {
    return _("Mesh key is required when mesh mode is enabled");
  }

  return true;
}

function validateTLSPair(sectionId: string, value: string, option: FormOption, sibling: string): true | string {
  const siblingValue = option.section.formvalue(sectionId, sibling) || "";

  if ((value && !siblingValue) || (!value && siblingValue)) {
    return _("Certificate and key must be provided together");
  }

  return true;
}

function formValue(option: FormOption, name: string, sectionId: string): unknown {
  const match = option.map.lookupOption(name, sectionId);
  return match?.[0].formvalue(match[1]);
}

function validateTLSForExternal(this: FormOption, sectionId: string, value: string, sibling: string): true | string {
  const pairResult = validateTLSPair(sectionId, value, this, sibling);
  if (pairResult !== true) {
    return pairResult;
  }

  const externalEnabled = formValue(this, "enabled", "external");
  if ((externalEnabled === "1" || externalEnabled === true) && !String(value ?? "").trim()) {
    return _("Certificate and key are required when the external endpoint is enabled");
  }

  return true;
}

function validateExternalEnabled(this: FormOption, _sectionId: string, value: unknown): true | string {
  if (value !== "1" && value !== true) {
    return true;
  }

  const certfile = String(formValue(this, "certfile", "tls") ?? "").trim();
  const keyfile = String(formValue(this, "keyfile", "tls") ?? "").trim();
  return certfile && keyfile
    ? true
    : _("Configure the TLS certificate and key before enabling the external endpoint");
}

function validateExternalPort(_sectionId: string, value: unknown): true | string {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "auto") {
    return true;
  }
  const port = Number(text);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? true
    : _("Port must be auto or an integer from 1 to 65535");
}

function validateRequiredForDERPMap(this: FormOption, sectionId: string, value: unknown): true | string {
  const enabled = this.section.formvalue(sectionId, "derpmap_sync");
  if ((enabled === "1" || enabled === true) && !String(value ?? "").trim()) {
    return _("This field is required when DERP map synchronization is enabled");
  }
  return true;
}

function validateDERPMapSync(this: FormOption, _sectionId: string, value: unknown): true | string {
  if (value !== "1" && value !== true) {
    return true;
  }

  const externalEnabled = formValue(this, "enabled", "external");
  return externalEnabled === "1" || externalEnabled === true
    ? true
    : _("Enable the external endpoint before enabling DERP map synchronization");
}

type SaveApplyContext = {
  map: FormMap;
  super: (method: string, args: unknown[]) => Promise<unknown>;
};

type MainViewContext = SaveApplyContext;


type StatusResponse = {
  verifyClients?: string[];
  running?: boolean;
  listen?: string;
  stun?: boolean;
  mesh?: boolean;
  opsSocket?: string;
  health?: string;
  error?: string;
  clients?: number;
  accepts?: number;
  bytesRecv?: number;
  bytesSent?: number;
  bytesRecvTotal?: number;
  bytesSentTotal?: number;
  acceptsTotal?: number;
  trafficPersist?: boolean;
  trafficPath?: string;
  trafficInterval?: number;
};

type VersionResponse = {
  version?: string;
};

type SettingsView = {
  badgeEl: HTMLElement;
  badgeDotEl: HTMLElement;
  badgeTextEl: HTMLElement;
  clientsEl: HTMLElement;
  trafficEl: HTMLElement;
  versionEl: HTMLElement;
  configContainerEl: HTMLElement;
  configPlaceholderEl: HTMLElement;
  jsonPreEl: HTMLElement;
  hostInputEl: HTMLInputElement;
  ipv4InputEl: HTMLInputElement;
  regionIdInputEl: HTMLInputElement;
  regionCodeInputEl: HTMLInputElement;
  regionNameInputEl: HTMLInputElement;
  derpPortInputEl: HTMLInputElement;
  stunPortInputEl: HTMLInputElement;
  currentListenPort: number;
  currentStunEnabled: boolean;
};


const poll = L.Poll;

const callStatus = rpc.declare<StatusResponse>({
  object: "luci.tailscale-derp",
  method: "get_status",
});

const callVersion = rpc.declare<VersionResponse>({
  object: "luci.tailscale-derp",
  method: "get_version",
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function pollStatus(view: SettingsView): Promise<void> {
  return Promise.all([callStatus(), callVersion(), callExternalStatus().catch(() => null)])
    .then(([statusData, versionData, externalData]) => {
      const status = statusData || {};
      const version = versionData || {};
      const isRunning = !!status.running;

      if (isRunning) {
        view.badgeEl.className = "derp-status-badge running";
        view.badgeDotEl.className = "derp-status-dot pulse";
        view.badgeTextEl.textContent = _("Running");
      } else {
        view.badgeEl.className = "derp-status-badge stopped";
        view.badgeDotEl.className = "derp-status-dot";
        view.badgeTextEl.textContent = _("Stopped");
      }

      view.versionEl.textContent = isRunning ? (version.version || _("Unknown")) : _("N/A");
      view.clientsEl.textContent = isRunning ? String(status.clients ?? 0) : "0";
      
      const bytesRecv = status.bytesRecv ?? 0;
      const bytesSent = status.bytesSent ?? 0;
      view.trafficEl.textContent = isRunning 
        ? `↓ ${formatBytes(bytesRecv)} / ↑ ${formatBytes(bytesSent)}`
        : "↓ 0 B / ↑ 0 B";

      view.configContainerEl.style.display = isRunning ? "" : "none";
      view.configPlaceholderEl.style.display = isRunning ? "none" : "";

      if (isRunning) {
        const listenAddress = status.listen || ":3478";
        const listenPort = parseInt(listenAddress.split(":").pop() || "3478") || 3478;
        view.currentListenPort = listenPort;
        view.currentStunEnabled = !!status.stun;
        view.ipv4InputEl.value = externalData?.endpoint?.ipv4 || "";
        view.derpPortInputEl.value = String(externalData?.endpoint?.derpPort ?? listenPort);
        view.stunPortInputEl.value = String(externalData?.endpoint?.stunPort ?? (status.stun ? listenPort : -1));
        (view as any).updateJson();
      }
    })
    .catch(() => {
      view.badgeEl.className = "derp-status-badge stopped";
      view.badgeDotEl.className = "derp-status-dot";
      view.badgeTextEl.textContent = _("Offline");
      view.versionEl.textContent = _("N/A");
      view.clientsEl.textContent = "0";
      view.trafficEl.textContent = "↓ 0 B / ↑ 0 B";
      view.configContainerEl.style.display = "none";
      view.configPlaceholderEl.style.display = "";
    });
}

export const main = (view as any).extend({
  map: null as FormMap | null,

  load() {
    return Promise.all([
      uci.load("tailscale-derp"),
      callStatus().catch(() => null),
      callVersion().catch(() => null),
      callExternalStatus().catch(() => null),
    ]);
  },

  handleSaveApply(this: MainViewContext, ev: Event, mode: string) {
    const expectedStatus = captureExpectedStatus(this.map);

    return this.super("handleSaveApply", [ev, mode])
      .then(() => callReloadConfig())
      .then(() => {
        savePendingStatus(expectedStatus);
        window.location.href = `/cgi-bin/luci/admin/services/derp/status`;
      })
      .catch((err: unknown) => {
        clearPendingStatus();
        const message = err instanceof Error ? err.message : "unknown error";
        ui.addNotification(null, <p>{_("Failed to reload DERP configuration:")} {message}</p>);
        throw err;
      });
  },

  render(this: MainViewContext, data: [unknown, StatusResponse | null, VersionResponse | null, ExternalStatus | null]) {

    const status = data[1] || {};
    const version = data[2] || {};
    const external = data[3] || {};
    const isRunning = !!status.running;

    const listenAddress = status.listen || ":3478";
    const listenPort = parseInt(listenAddress.split(":").pop() || "3478") || 3478;

    const hostInput = <input type="text" class="cbi-input-text" style="width:100%" placeholder="derp.example.com" /> as HTMLInputElement;
    const ipv4Input = <input type="text" class="cbi-input-text" style="width:100%" value={external.endpoint?.ipv4 || ""} readOnly /> as HTMLInputElement;
    const regionIdInput = <input type="number" class="cbi-input-text" style="width:100%" value="900" /> as HTMLInputElement;
    const regionCodeInput = <input type="text" class="cbi-input-text" style="width:100%" value="openwrt-derp" /> as HTMLInputElement;
    const regionNameInput = <input type="text" class="cbi-input-text" style="width:100%" value="OpenWrt DERP Relay" /> as HTMLInputElement;
    const derpPortInput = <input type="number" class="cbi-input-text" style="width:100%" value={String(external.endpoint?.derpPort || listenPort)} readOnly /> as HTMLInputElement;
    const stunPortInput = <input type="number" class="cbi-input-text" style="width:100%" value={String(external.endpoint?.stunPort ?? (status.stun ? listenPort : -1))} readOnly /> as HTMLInputElement;

    const jsonPre = <div class="derp-json-pre"></div> as HTMLElement;
    const copyBtn = <button class="cbi-button derp-copy-btn">{_("Copy")}</button> as HTMLButtonElement;

    const viewState: SettingsView = {
      badgeEl: null as any,
      badgeDotEl: null as any,
      badgeTextEl: null as any,
      clientsEl: null as any,
      trafficEl: null as any,
      versionEl: null as any,
      configContainerEl: null as any,
      configPlaceholderEl: null as any,
      jsonPreEl: jsonPre,
      hostInputEl: hostInput,
      ipv4InputEl: ipv4Input,
      regionIdInputEl: regionIdInput,
      regionCodeInputEl: regionCodeInput,
      regionNameInputEl: regionNameInput,
      derpPortInputEl: derpPortInput,
      stunPortInputEl: stunPortInput,
      currentListenPort: listenPort,
      currentStunEnabled: !!status.stun
    };

    const updateJson = () => {
      const host = hostInput.value.trim() || "derp.example.com";
      const ipv4 = ipv4Input.value.trim();
      const regionId = parseInt(regionIdInput.value) || 900;
      const regionCode = regionCodeInput.value.trim() || "openwrt-derp";
      const regionName = regionNameInput.value.trim() || "OpenWrt DERP Relay";
      const derpPort = parseInt(derpPortInput.value) || viewState.currentListenPort;
      const stunPort = parseInt(stunPortInput.value) || viewState.currentListenPort;
      const hasStun = viewState.currentStunEnabled;

      const derpMap = {
        "Regions": {
          [regionId]: {
            "RegionID": regionId,
            "RegionCode": regionCode,
            "RegionName": regionName,
            "Nodes": [
              {
                "Name": `${regionId}a`,
                "RegionID": regionId,
                "HostName": host,
                ...(ipv4 ? { "IPv4": ipv4 } : {}),
                "DERPPort": derpPort,
                "STUNPort": hasStun ? stunPort : -1
              }
            ]
          }
        }
      };

      jsonPre.textContent = JSON.stringify(derpMap, null, 2);
    };

    (viewState as any).updateJson = updateJson;

    hostInput.oninput = updateJson;
    regionIdInput.oninput = updateJson;
    regionCodeInput.oninput = updateJson;
    regionNameInput.oninput = updateJson;
    derpPortInput.oninput = updateJson;
    stunPortInput.oninput = updateJson;

    copyBtn.onclick = (ev: MouseEvent) => {
      ev.preventDefault();
      copyText(jsonPre.textContent || "")
        .then(() => {
          copyBtn.textContent = _("Copied!");
          setTimeout(() => {
            copyBtn.textContent = _("Copy");
          }, 2000);
        })
        .catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          ui.addNotification(null, <p>{_("Failed to copy configuration to clipboard:")} {errMsg}</p>);
        });
    };

    updateJson();

    const styleEl = (
      <style>{`
        .derp-status-card {
          border-radius: 8px;
          padding: 1.5em;
          margin-bottom: 2em;
          transition: all 0.3s ease;
        }
        .derp-status-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.2em;
          flex-wrap: wrap;
          gap: 1em;
        }
        .derp-status-title {
          font-size: 1.25em;
          font-weight: 600;
          margin: 0;
        }
        .derp-status-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.35em 0.85em;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.85em;
          gap: 0.4em;
        }
        .derp-status-badge.running {
          color: #1a7f37;
        }
        .derp-status-badge.stopped {
          color: #cf222e;
        }
        .derp-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: currentColor;
        }
        .derp-status-dot.pulse {
          animation: derp-pulse 1.8s infinite ease-in-out;
        }
        @keyframes derp-pulse {
          0% { transform: scale(0.95); opacity: 0.7; }
          70% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.7; }
        }
        .derp-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 1.2em;
          margin-bottom: 1.2em;
        }
        .derp-metric-item {
          border-radius: 6px;
          padding: 0.8em 1em;
          display: flex;
          flex-direction: column;
        }
        .derp-metric-label {
          font-size: 0.85em;
          margin-bottom: 0.3em;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .derp-metric-value {
          font-size: 1.15em;
          font-weight: bold;
        }
        .derp-config-details {
          border-radius: 6px;
          margin-top: 1em;
        }
        .derp-config-summary {
          padding: 0.8em 1.2em;
          font-weight: 600;
          cursor: pointer;
          outline: none;
          user-select: none;
        }
        .derp-config-summary:hover {
          text-decoration: underline;
        }
        .derp-config-content {
          padding: 1.2em;
        }
        .derp-config-inputs {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 0.8em;
          margin-bottom: 1em;
        }
        .derp-config-input-group {
          display: flex;
          flex-direction: column;
        }
        .derp-config-input-group label {
          font-size: 0.85em;
          font-weight: 600;
          margin-bottom: 0.3em;
        }
        .derp-config-input-group input {
          padding: 0.4em 0.6em;
          border-radius: 4px;
        }
        .derp-json-wrapper {
          position: relative;
          margin-top: 1em;
        }
        .derp-json-pre {
          padding: 1.2em;
          border-radius: 6px;
          font-family: monospace;
          font-size: 0.95em;
          overflow-x: auto;
          margin: 0;
          max-height: 250px;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .derp-copy-btn {
          position: absolute;
          top: 0.6em;
          right: 0.6em;
          padding: 0.4em 0.8em;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.8em;
          transition: all 0.2s ease;
        }
        .derp-placeholder-box {
          padding: 1em;
          border-style: dashed;
          border-radius: 6px;
          text-align: center;
          margin-top: 1em;
        }
      `}</style>
    );

    const badgeDot = <span class={isRunning ? "derp-status-dot pulse" : "derp-status-dot"}></span>;
    const badgeText = <span>{isRunning ? _("Running") : _("Stopped")}</span>;
    const badge = (
      <span class={isRunning ? "derp-status-badge running" : "derp-status-badge stopped"}>
        {badgeDot}
        {badgeText}
      </span>
    );

    const versionVal = <span>{isRunning ? (version.version || _("Unknown")) : _("N/A")}</span>;
    const clientsVal = <span>{isRunning ? String(status.clients ?? 0) : "0"}</span>;
    const trafficVal = (
      <span>
        {isRunning 
          ? `↓ ${formatBytes(status.bytesRecv ?? 0)} / ↑ ${formatBytes(status.bytesSent ?? 0)}`
          : "↓ 0 B / ↑ 0 B"}
      </span>
    );

    const configContainer = (
      <div class="derp-config-details" style={isRunning ? "" : "display: none;"}>
        <div class="derp-config-summary">{_("Tailscale ACL Configuration (DERP Map)")}</div>
        <div class="derp-config-content">
          <p style="margin-bottom: 1em; font-size: 0.9em;">
            {_("You can paste this JSON into your Tailscale ACL configuration (derpMap section) to allow clients to use this relay. Customize the parameters below to match your public setup:")}
          </p>
          <div class="derp-config-inputs">
            <div class="derp-config-input-group">
              <label>{_("TLS Hostname")}</label>
              {hostInput}
            </div>
            <div class="derp-config-input-group">
              <label>{_("Mapped Public IPv4")}</label>
              {ipv4Input}
            </div>
            <div class="derp-config-input-group">
              <label>{_("Region ID")}</label>
              {regionIdInput}
            </div>
            <div class="derp-config-input-group">
              <label>{_("Region Code")}</label>
              {regionCodeInput}
            </div>
            <div class="derp-config-input-group">
              <label>{_("Region Name")}</label>
              {regionNameInput}
            </div>
            <div class="derp-config-input-group">
              <label>{_("DERP Port")}</label>
              {derpPortInput}
            </div>
            <div class="derp-config-input-group">
              <label>{_("STUN Port")}</label>
              {stunPortInput}
            </div>
          </div>
          <div class="derp-json-wrapper">
            {jsonPre}
            {copyBtn}
          </div>
        </div>
      </div>
    );

    const configPlaceholder = (
      <div class="derp-placeholder-box" style={isRunning ? "display: none;" : ""}>
        {_("DERP configuration JSON will be available here when the service is running.")}
      </div>
    );

    viewState.badgeEl = badge;
    viewState.badgeDotEl = badgeDot;
    viewState.badgeTextEl = badgeText;
    viewState.versionEl = versionVal;
    viewState.clientsEl = clientsVal;
    viewState.trafficEl = trafficVal;
    viewState.configContainerEl = configContainer;
    viewState.configPlaceholderEl = configPlaceholder;

    const statusCard = (
      <div class="derp-status-card cbi-section">
        {styleEl}
        <div class="derp-status-header">
          <h4 class="derp-status-title">{_("DERP Server Status")}</h4>
          {badge}
        </div>
        <div class="derp-metrics-grid">
          <div class="derp-metric-item">
            <span class="derp-metric-label">{_("Version")}</span>
            <span class="derp-metric-value">{versionVal}</span>
          </div>
          <div class="derp-metric-item">
            <span class="derp-metric-label">{_("Connected Clients")}</span>
            <span class="derp-metric-value">{clientsVal}</span>
          </div>
          <div class="derp-metric-item">
            <span class="derp-metric-label">{_("Traffic (Session)")}</span>
            <span class="derp-metric-value">{trafficVal}</span>
          </div>
        </div>
        {configContainer}
        {configPlaceholder}
      </div>
    );

    const m = new form.Map("tailscale-derp", _("Tailscale DERP Relay"), _("Configure the Tailscale DERP relay server."));
    this.map = m;

    let s = m.section(form.TypedSection, "settings", _("Global Settings"));
    s.anonymous = true;

    let o: FormOption = s.option(form.Flag, "enabled", _("Enable Service"), _("Start DERP service on boot"));
    o.default = "1";
    o.rmempty = false;

    o = s.option(form.Value, "listen", _("Listen Address"), _("Address and port for DERP/STUN (e.g. :3478)"));
    o.default = ":3478";
    o.rmempty = false;
    o.placeholder = ":3478";
    o.validate = (_sectionId: string, value: any) => validateSocketAddress("Listen address", value);

    o = s.option(form.Flag, "stun", _("Enable STUN"), _("Enable STUN server on the same port"));
    o.default = "1";
    o.rmempty = false;

    s = m.section(form.TypedSection, "tls", _("TLS Settings"));
    s.anonymous = true;

    o = s.option(form.Value, "certfile", _("Certificate File"), _("Path to TLS certificate (leave empty for auto)"));
    o.placeholder = "/etc/ssl/certs/derp.pem";
    o.rmempty = true;
    o.validate = function (this: FormOption, sectionId: string, value: any) {
      return validateTLSForExternal.call(this, sectionId, value, "keyfile");
    };

    o = s.option(form.Value, "keyfile", _("Key File"), _("Path to TLS private key (leave empty for auto)"));
    o.placeholder = "/etc/ssl/private/derp.key";
    o.rmempty = true;
    o.validate = function (this: FormOption, sectionId: string, value: any) {
      return validateTLSForExternal.call(this, sectionId, value, "certfile");
    };

    s = m.section(form.TypedSection, "external", _("External Endpoint (Experimental)"), _("Publish DERP and STUN through PCP, NAT-PMP, or UPnP and synchronize the mapped endpoint into selected Tailnet policies. Tailscale does not officially support custom DERP servers behind NAT."));
    s.anonymous = true;

    o = s.option(form.Flag, "enabled", _("Enable External Endpoint"), _("Acquire router port mappings and allow selected API instances to publish this endpoint"));
    o.default = "0";
    o.rmempty = false;
    o.validate = validateExternalEnabled;

    o = s.option(form.DynamicList, "method", _("Mapping Methods"), _("Methods are attempted in this order"));
    o.value("pcp", "PCP");
    o.value("natpmp", "NAT-PMP");
    o.value("upnp", "UPnP IGD");
    o.default = ["pcp", "natpmp", "upnp"];
    o.rmempty = false;
    o.depends("enabled", "1");

    o = s.option(form.Value, "wan_interface", _("WAN Interface"), _("Use auto to follow the IPv4 default route, or enter a network interface name"));
    o.default = "auto";
    o.rmempty = false;
    o.depends("enabled", "1");

    o = s.option(form.Value, "derp_port", _("External DERP Port"), _("auto reads the actual local TCP listener and requests the same public port; the gateway may assign another port"));
    o.default = "auto";
    o.rmempty = false;
    o.validate = validateExternalPort;
    o.depends("enabled", "1");

    o = s.option(form.Value, "stun_port", _("External STUN Port"), _("auto reads the actual local UDP listener and requests the same public port; the gateway may assign another port"));
    o.default = "auto";
    o.rmempty = false;
    o.validate = validateExternalPort;
    o.depends("enabled", "1");

    o = s.option(form.Value, "lease_seconds", _("Mapping Lease (seconds)"));
    o.default = "7200";
    o.rmempty = false;
    o.datatype = "uinteger";
    o.depends("enabled", "1");

    o = s.option(form.Value, "retry_seconds", _("Retry Interval (seconds)"));
    o.default = "60";
    o.rmempty = false;
    o.datatype = "uinteger";
    o.depends("enabled", "1");

    o = s.option(form.Value, "sync_interval", _("DERP Map Sync Interval (seconds)"));
    o.default = "300";
    o.rmempty = false;
    o.datatype = "uinteger";
    o.depends("enabled", "1");

    o = s.option(form.Flag, "validate_endpoint", _("Validate Endpoint Locally"), _("Require a local NAT-loopback DERP/TLS and STUN check before publishing. This does not prove Internet reachability. Three consecutive failures withdraw the managed nodes until recovery."));
    o.default = "0";
    o.rmempty = false;
    o.depends("enabled", "1");

    s = m.section(form.TypedSection, "mesh", _("Mesh Settings"));
    s.anonymous = true;

    o = s.option(form.Flag, "enabled", _("Enable Mesh"), _("Enable DERP mesh mode"));
    o.default = "0";
    o.rmempty = false;

    o = s.option(form.Value, "key", _("Mesh Shared Key"), _("Shared mesh key passed to the DERP server when mesh mode is enabled"));
    o.rmempty = true;
    o.depends("enabled", "1");
    o.password = true;
    o.validate = validateMeshKey;

    s = m.section(form.TypedSection, "verify", _("Client Verification"));
    s.anonymous = true;

    o = s.option(form.Flag, "enabled", _("Enable Client Verification"), _("Require a client to pass at least one enabled verification method"));
    o.default = "0";
    o.rmempty = false;

    o = s.option(form.Flag, "url_enabled", _("Enable Verify URLs"), _("Allow clients accepted by any configured admission controller URL"));
    o.default = "0";
    o.rmempty = false;
    o.depends("enabled", "1");

    o = s.option(form.DynamicList, "url", _("Verify URLs"), _("Admission controller URLs for verifying DERP clients"));
    o.rmempty = true;
    o.placeholder = "https://your-admission-controller/verify";
    o.depends({
      "tailscale-derp.verify.enabled": "1",
      "tailscale-derp.verify.url_enabled": "1"
    });

    o = s.option(form.Flag, "tailscaled_enabled", _("Enable tailscaled Verification"), _("Verify clients against the local tailscaled instance using its default socket"));
    o.default = "0";
    o.rmempty = false;
    o.depends("enabled", "1");

    o = s.option(form.Flag, "tailscaled_socket_enabled", _("Use Custom tailscaled Socket"), _("Use a custom socket path instead of tailscaled's default socket"));
    o.default = "0";
    o.rmempty = false;
    o.depends({
      "tailscale-derp.verify.enabled": "1",
      "tailscale-derp.verify.tailscaled_enabled": "1"
    });

    o = s.option(form.Value, "tailscaled_socket", _("Custom tailscaled Socket"), _("Path to the local tailscaled socket"));
    o.rmempty = true;
    o.placeholder = "/var/run/tailscale/tailscaled.sock";
    o.depends({
      "tailscale-derp.verify.enabled": "1",
      "tailscale-derp.verify.tailscaled_enabled": "1",
      "tailscale-derp.verify.tailscaled_socket_enabled": "1"
    });

    o = s.option(form.Flag, "api_enabled", _("Enable Official API Verification"), _("Allow authorized, non-expired devices from configured Tailscale API instances"));
    o.default = "0";
    o.rmempty = false;
    o.depends("enabled", "1");

    o = s.option(form.Value, "sync_interval", _("API Sync Interval (seconds)"), _("How often to refresh configured Tailscale API instances"));
    o.default = "300";
    o.rmempty = false;
    o.datatype = "uinteger";
    o.depends({
      "tailscale-derp.verify.enabled": "1"
    });

    o = s.option(form.Value, "cache_ttl", _("API Cache TTL (seconds)"), _("Cached devices older than this are not used for authentication"));
    o.default = "900";
    o.rmempty = false;
    o.datatype = "uinteger";
    o.depends({
      "tailscale-derp.verify.enabled": "1"
    });

    const apiSection = m.section(form.GridSection, "verify_api", _("Official API Instances"));
    apiSection.anonymous = true;
    apiSection.addremove = true;
    apiSection.sortable = true;
    apiSection.nodescriptions = true;
    apiSection.addbtntitle = _("Add API Instance");
    apiSection.delbtntitle = _("Delete");

    o = apiSection.option(form.Value, "label", _("Name"), _("A display name used in LuCI and device sources"));
    o.rmempty = true;

    o = apiSection.option(form.Value, "tailnet", _("Tailnet"), _("Use - for the credential's default tailnet, or enter a tailnet ID"));
    o.default = "-";
    o.rmempty = false;

    o = apiSection.option(form.ListValue, "auth_type", _("Authentication"), _("Choose API access token or OAuth Client Credentials. OAuth access tokens are acquired and renewed automatically."));
    o.value("api_key", _("API Access Token"));
    o.value("oauth", _("OAuth Client Credentials"));
    o.default = "api_key";
    o.rmempty = false;

    o = apiSection.option(form.Value, "api_key", _("API Access Token"), _("Enter a new API access token; leave empty to keep the current value"));
    o.password = true;
    o.rmempty = true;
    o.placeholder = _("Leave empty to keep the current key");
    o.depends("auth_type", "api_key");
    o.load = () => "";
    o.write = (sectionId: string, formvalue: string | string[]) => {
      const value = Array.isArray(formvalue) ? formvalue[0] : formvalue;
      const apiKey = String(value || "").trim();
      if (apiKey) {
        uci.set("tailscale-derp", sectionId, "api_key", apiKey);
      }
      return null;
    };
    o.remove = () => {
      // An empty field preserves the existing value. Removing the instance removes its credentials.
    };

    o = apiSection.option(form.Value, "oauth_client_id", _("OAuth Client ID"), _("Enter a new client ID; leave empty to keep the current value"));
    o.rmempty = true;
    o.placeholder = _("Leave empty to keep the current client ID");
    o.depends("auth_type", "oauth");
    o.load = () => "";
    o.write = (sectionId: string, formvalue: string | string[]) => {
      const value = Array.isArray(formvalue) ? formvalue[0] : formvalue;
      const clientID = String(value || "").trim();
      if (clientID) {
        uci.set("tailscale-derp", sectionId, "oauth_client_id", clientID);
      }
      return null;
    };

    o = apiSection.option(form.Value, "oauth_client_secret", _("OAuth Client Secret"), _("Enter a new client secret; leave empty to keep the current value"));
    o.password = true;
    o.rmempty = true;
    o.placeholder = _("Leave empty to keep the current client secret");
    o.depends("auth_type", "oauth");
    o.load = () => "";
    o.write = (sectionId: string, formvalue: string | string[]) => {
      const value = Array.isArray(formvalue) ? formvalue[0] : formvalue;
      const clientSecret = String(value || "").trim();
      if (clientSecret) {
        uci.set("tailscale-derp", sectionId, "oauth_client_secret", clientSecret);
      }
      return null;
    };

    o = apiSection.option(form.Flag, "derpmap_sync", _("Sync DERP Map"), _("Publish this router's mapped endpoint into this Tailnet policy. Credentials must have policy file write permission."));
    o.default = "0";
    o.rmempty = false;
    o.validate = validateDERPMapSync;

    o = apiSection.option(form.Value, "region_id", _("Region ID"), _("Custom DERP region ID (900-999)"));
    o.placeholder = "900";
    o.datatype = "range(900,999)";
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;

    o = apiSection.option(form.Value, "region_code", _("Region Code"));
    o.placeholder = "openwrt-derp";
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;

    o = apiSection.option(form.Value, "region_name", _("Region Name"));
    o.placeholder = _("OpenWrt DERP Relay");
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;

    o = apiSection.option(form.Value, "node_name", _("Node Name"), _("Stable ownership key used to update or withdraw only this managed node"));
    o.placeholder = "900a";
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;

    o = apiSection.option(form.Value, "hostname", _("TLS Hostname"), _("Stable DNS name covered by the DERP server certificate"));
    o.placeholder = "derp.example.com";
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;

    o = apiSection.option(form.Value, "cert_name", _("Certificate Name"), _("Optional TLS certificate verification name when it differs from the hostname"));
    o.rmempty = true;
    o.depends("derpmap_sync", "1");

    s = m.section(form.TypedSection, "ops", _("Operations"));
    s.anonymous = true;

    o = s.option(form.Value, "socket", _("Ops Unix Socket"), _("Unix socket used by LuCI and local management requests"));
    o.default = "/var/run/tailscale-derp/ops.sock";
    o.rmempty = false;
    o.placeholder = "/var/run/tailscale-derp/ops.sock";
    o.validate = (_sectionId: string, value: unknown) => validateUnixSocketPath("Ops socket path", String(value ?? ""));

    o = s.option(form.Value, "health", _("Health Port"), _("Port for health check endpoint"));
    o.default = ":9912";
    o.rmempty = false;
    o.placeholder = ":9912";
    o.validate = (_sectionId: string, value: any) => validateSocketAddress("Health address", value);

    s = m.section(form.TypedSection, "traffic", _("Traffic Statistics"));
    s.anonymous = true;

    o = s.option(form.Flag, "persist", _("Enable Persistence"), _("Save cumulative traffic statistics to file across restarts"));
    o.default = "0";
    o.rmempty = false;

    o = s.option(form.Value, "path", _("Storage Path"), _("File path for storing traffic statistics (use tmpfs to minimize flash writes)"));
    o.default = "/tmp/tailscale-derp-traffic.json";
    o.rmempty = true;
    o.placeholder = "/tmp/tailscale-derp-traffic.json";
    o.depends("persist", "1");

    o = s.option(form.Value, "interval", _("Save Interval (seconds)"), _("How often to save traffic statistics (higher = less flash wear)"));
    o.default = "60";
    o.rmempty = true;
    o.placeholder = "60";
    o.depends("persist", "1");

    return m.render().then((mapEl) => {
      poll.add(() => pollStatus(viewState), 5);
      return (
        <div>
          {statusCard}
          {mapEl}
        </div>
      );
    });
  }
});
