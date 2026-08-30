import { ensureNamedSections } from "@/shared/sections";

type ReloadConfigResponse = Record<string, never>;
type FormOption = any;
type ExternalViewContext = {
  super: (method: string, args: unknown[]) => Promise<unknown>;
};

const view = L.view;
const form = L.form;
const rpc = L.rpc;
const uci = L.uci;
const ui = L.ui;

const callReloadConfig = rpc.declare<ReloadConfigResponse>({
  object: "luci.tailscale-derp",
  method: "reload_config",
});

function formValue(option: FormOption, name: string, sectionId: string): unknown {
  const match = option.map.lookupOption(name, sectionId);
  return match?.[0].formvalue(match[1]);
}

function validateTLSPair(sectionId: string, value: string, option: FormOption, sibling: string): true | string {
  const siblingValue = option.section.formvalue(sectionId, sibling) || "";
  if ((value && !siblingValue) || (!value && siblingValue)) {
    return _("Certificate and key must be provided together");
  }

  return true;
}

function validateTLSForExternal(this: FormOption, sectionId: string, value: string, sibling: string): true | string {
  const pairResult = validateTLSPair(sectionId, value, this, sibling);
  if (pairResult !== true) {
    return pairResult;
  }

  const externalEnabled = formValue(this, "enabled", "external");
  if ((externalEnabled === "1" || externalEnabled === true) && !value.trim()) {
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

export const main = (view as any).extend({
  load() {
    return uci.load("tailscale-derp").then(() => {
      ensureNamedSections(uci, "tailscale-derp", [
        ["tls", "tls"],
        ["external", "external", {
          enabled: "0",
          method: ["pcp", "natpmp", "upnp"],
          wan_interface: "auto",
          derp_port: "auto",
          stun_port: "auto",
          lease_seconds: "7200",
          retry_seconds: "60",
          sync_interval: "300",
          validate_endpoint: "0",
        }],
      ]);
    });
  },

  handleSaveApply(this: ExternalViewContext, ev: Event, mode: string) {
    return this.super("handleSaveApply", [ev, mode])
      .then(() => callReloadConfig())
      .then(() => {
        window.location.href = "/cgi-bin/luci/admin/services/derp/status";
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown error";
        ui.addNotification(null, <p>{_("Failed to reload DERP configuration:")} {message}</p>);
        throw err;
      });
  },

  render() {
    const m = new form.Map(
      "tailscale-derp",
      _("External Endpoint"),
      _("Publish this DERP relay through a WAN gateway. Tailscale does not officially support custom DERP servers behind NAT."),
    );

    let s = m.section(form.NamedSection, "tls", "tls", _("TLS Settings"));

    let o: FormOption = s.option(form.Value, "certfile", _("Certificate File"), _("Path to TLS certificate (leave empty for auto)"));
    o.placeholder = "/etc/ssl/certs/derp.pem";
    o.rmempty = true;
    o.validate = function (this: FormOption, sectionId: string, value: string) {
      return validateTLSForExternal.call(this, sectionId, value, "keyfile");
    };

    o = s.option(form.Value, "keyfile", _("Key File"), _("Path to TLS private key (leave empty for auto)"));
    o.placeholder = "/etc/ssl/private/derp.key";
    o.rmempty = true;
    o.validate = function (this: FormOption, sectionId: string, value: string) {
      return validateTLSForExternal.call(this, sectionId, value, "certfile");
    };

    s = m.section(
      form.NamedSection,
      "external",
      "external",
      _("External Endpoint (Experimental)"),
      _("Acquire router port mappings and optionally publish the mapped endpoint into selected Tailnet policies."),
    );

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

    return m.render();
  },
});
