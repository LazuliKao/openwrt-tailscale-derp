import { captureExpectedStatus, clearPendingStatus, savePendingStatus, validateSocketAddress, validateUnixSocketPath } from "@/shared/config";
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
  return Promise.all([callStatus(), callVersion()])
    .then(([statusData, versionData]) => {
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

  render(this: MainViewContext, data: [unknown, StatusResponse | null, VersionResponse | null]) {

    const status = data[1] || {};
    const version = data[2] || {};
    const isRunning = !!status.running;

    const listenAddress = status.listen || ":3478";
    const listenPort = parseInt(listenAddress.split(":").pop() || "3478") || 3478;

    const hostInput = <input type="text" class="cbi-input-text" style="width:100%" value={window.location.hostname} /> as HTMLInputElement;
    const regionIdInput = <input type="number" class="cbi-input-text" style="width:100%" value="900" /> as HTMLInputElement;
    const regionCodeInput = <input type="text" class="cbi-input-text" style="width:100%" value="openwrt-derp" /> as HTMLInputElement;
    const regionNameInput = <input type="text" class="cbi-input-text" style="width:100%" value="OpenWrt DERP Relay" /> as HTMLInputElement;
    const derpPortInput = <input type="number" class="cbi-input-text" style="width:100%" value={String(listenPort)} /> as HTMLInputElement;
    const stunPortInput = <input type="number" class="cbi-input-text" style="width:100%" value={String(listenPort)} /> as HTMLInputElement;

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
      regionIdInputEl: regionIdInput,
      regionCodeInputEl: regionCodeInput,
      regionNameInputEl: regionNameInput,
      derpPortInputEl: derpPortInput,
      stunPortInputEl: stunPortInput,
      currentListenPort: listenPort,
      currentStunEnabled: !!status.stun
    };

    const updateJson = () => {
      const host = hostInput.value.trim() || window.location.hostname;
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
                "DERPPort": derpPort,
                ...(hasStun ? { "STUNPort": stunPort } : {})
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
              <label>{_("Public HostName / IP")}</label>
              {hostInput}
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
      return validateTLSPair(sectionId, value, this, "keyfile");
    };

    o = s.option(form.Value, "keyfile", _("Key File"), _("Path to TLS private key (leave empty for auto)"));
    o.placeholder = "/etc/ssl/private/derp.key";
    o.rmempty = true;
    o.validate = function (this: FormOption, sectionId: string, value: any) {
      return validateTLSPair(sectionId, value, this, "certfile");
    };

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
