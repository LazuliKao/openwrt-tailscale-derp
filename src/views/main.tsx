import {
  captureExpectedStatus,
  clearPendingStatus,
  savePendingStatus,
  validateSocketAddress,
  validateUnixSocketPath,
} from "@/shared/config";

type ReloadConfigResponse = Record<string, never>;
type FormMap = LuCI.form.Map;
type FormOption = any;

type SaveApplyContext = {
  map: FormMap;
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

function validateMeshKey(this: FormOption, sectionId: string, value: unknown): true | string {
  const enabled = this.section.formvalue(sectionId, "enabled");
  if ((enabled === "1" || enabled === true) && !value) {
    return _("Mesh key is required when mesh mode is enabled");
  }

  return true;
}

export const main = (view as any).extend({
  map: null as FormMap | null,

  load() {
    return uci.load("tailscale-derp");
  },

  handleSaveApply(this: SaveApplyContext, ev: Event, mode: string) {
    const expectedStatus = captureExpectedStatus(this.map);

    return this.super("handleSaveApply", [ev, mode])
      .then(() => callReloadConfig())
      .then(() => {
        savePendingStatus(expectedStatus);
        window.location.href = "/cgi-bin/luci/admin/services/derp/status";
      })
      .catch((err: unknown) => {
        clearPendingStatus();
        const message = err instanceof Error ? err.message : "unknown error";
        ui.addNotification(null, <p>{_("Failed to reload DERP configuration:")} {message}</p>);
        throw err;
      });
  },

  render(this: SaveApplyContext) {
    const m = new form.Map(
      "tailscale-derp",
      _("Service Configuration"),
      _("Configure the local Tailscale DERP relay service."),
    );
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
    o.validate = (_sectionId: string, value: string) => validateSocketAddress("Listen address", value);

    o = s.option(form.Flag, "stun", _("Enable STUN"), _("Enable STUN server on the same port"));
    o.default = "1";
    o.rmempty = false;

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

    s = m.section(form.TypedSection, "ops", _("Operations"));
    s.anonymous = true;

    o = s.option(form.Value, "socket", _("Ops Unix Socket"), _("Unix socket used by LuCI and local management requests"));
    o.default = "/var/run/tailscale-derp/ops.sock";
    o.rmempty = false;
    o.placeholder = "/var/run/tailscale-derp/ops.sock";
    o.validate = (_sectionId: string, value: string) => validateUnixSocketPath("Ops Unix Socket", value);

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
    o.datatype = "uinteger";
    o.depends("persist", "1");

    return m.render();
  },
});
