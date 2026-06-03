import { captureExpectedStatus, clearPendingStatus, savePendingStatus, validateLoopbackSocketAddress, validateSocketAddress } from "@/shared/config";

type ReloadConfigResponse = Record<string, never>;
type FormMap = LuCI.form.CBIMap;
type FormOption = LuCI.form.CBIAbstractValue;

const view = L.view;
const form = L.form;
const rpc = L.rpc;
const ui = LuCI.ui;
const uci = L.uci;

const callReloadConfig = rpc.declare<ReloadConfigResponse>({
  object: "luci.tailscale-derp",
  method: "reload_config",
});

function validateMeshKey(this: FormOption, sectionId: string, value: string): true | string {
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

export const main = view.extend({
  map: null as FormMap | null,

  load() {
    return Promise.all([uci.load("tailscale-derp")]);
  },

  handleSaveApply(this: SaveApplyContext, ev: Event, mode: string) {
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

  render(this: { map: FormMap | null }) {
    const m = new form.Map("tailscale-derp", _("Tailscale DERP Relay"), _("Configure the Tailscale DERP relay server."));
    this.map = m;

    let s = m.section(form.TypedSection, "settings", _("Global Settings"));
    s.anonymous = true;

    let o = s.option(form.Flag, "enabled", _("Enable Service"), _("Start DERP service on boot"));
    o.default = "0";
    o.rmempty = false;

    o = s.option(form.Value, "listen", _("Listen Address"), _("Address and port for DERP/STUN (e.g. :3478)"));
    o.default = ":3478";
    o.rmempty = false;
    o.placeholder = ":3478";
    o.validate = (_sectionId: string, value: string) => validateSocketAddress("Listen address", value);

    o = s.option(form.Flag, "stun", _("Enable STUN"), _("Enable STUN server on the same port"));
    o.default = "1";
    o.rmempty = false;

    s = m.section(form.TypedSection, "tls", _("TLS Settings"));
    s.anonymous = true;

    o = s.option(form.Value, "certfile", _("Certificate File"), _("Path to TLS certificate (leave empty for auto)"));
    o.placeholder = "/etc/ssl/certs/derp.pem";
    o.rmempty = true;
    o.validate = function (this: FormOption, sectionId: string, value: string) {
      return validateTLSPair(sectionId, value, this, "keyfile");
    };

    o = s.option(form.Value, "keyfile", _("Key File"), _("Path to TLS private key (leave empty for auto)"));
    o.placeholder = "/etc/ssl/private/derp.key";
    o.rmempty = true;
    o.validate = function (this: FormOption, sectionId: string, value: string) {
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

    o = s.option(form.DynamicList, "url", _("Verify URLs"), _("Admission controller URLs for verifying DERP clients (comma-separated or multiple entries)"));
    o.rmempty = true;
    o.placeholder = "https://your-admission-controller/verify";

    o = s.option(form.Flag, "fail_open", _("Fail Open"), _("Allow clients to connect if all verify URLs are unreachable"));
    o.default = "0";
    o.rmempty = false;
    s = m.section(form.TypedSection, "ops", _("Operations"));
    s.anonymous = true;

    o = s.option(form.Value, "metrics", _("Metrics Port"), _("Port for Prometheus metrics endpoint"));
    o.default = "127.0.0.1:9911";
    o.rmempty = false;
    o.placeholder = "127.0.0.1:9911";
    o.validate = (_sectionId: string, value: string) => validateLoopbackSocketAddress("Metrics address", value);

    o = s.option(form.Value, "health", _("Health Port"), _("Port for health check endpoint"));
    o.default = ":9912";
    o.rmempty = false;
    o.placeholder = ":9912";
    o.validate = (_sectionId: string, value: string) => validateSocketAddress("Health address", value);

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

    return m.render();
  }
});
