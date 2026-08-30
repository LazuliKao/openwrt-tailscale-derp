import { validateUnixSocketPath } from "@/shared/config";
import { ensureNamedSections } from "@/shared/sections";

type ReloadConfigResponse = Record<string, never>;
type FormOption = any;
type AuthenticationViewContext = {
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

function externalEndpointEnabled(): boolean {
  return String(uci.get("tailscale-derp", "external", "enabled") ?? "") === "1";
}

function validateRequiredForDERPMap(this: FormOption, sectionId: string, value: unknown): true | string {
  const enabled = this.section.formvalue(sectionId, "derpmap_sync");
  if ((enabled === "1" || enabled === true) && !String(value ?? "").trim()) {
    return _("This field is required when DERP map synchronization is enabled");
  }

  return true;
}

function validateDERPMapSync(_sectionId: string, value: unknown): true | string {
  if (value !== "1" && value !== true) {
    return true;
  }

  return externalEndpointEnabled()
    ? true
    : _("Enable the external endpoint before enabling DERP map synchronization");
}

function preserveSecret(option: FormOption, name: string): void {
  option.load = () => "";
  option.write = (sectionId: string, formValue: string | string[]) => {
    const value = Array.isArray(formValue) ? formValue[0] : formValue;
    const secret = String(value || "").trim();
    if (secret) {
      uci.set("tailscale-derp", sectionId, name, secret);
    }
    return null;
  };
  option.remove = () => undefined;
}

function modalOnly(option: FormOption): void {
  (option as any).modalonly = true;
}

export const main = (view as any).extend({
  load() {
    return uci.load("tailscale-derp").then(() => {
      ensureNamedSections(uci, "tailscale-derp", [["verify", "verify"]]);
    });
  },

  handleSaveApply(this: AuthenticationViewContext, ev: Event, mode: string) {
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
      _("Authentication"),
      _("Configure client admission verification and Tailscale API credentials."),
    );

    let s = m.section(form.NamedSection, "verify", "verify", _("Client Verification"));

    let o: FormOption = s.option(form.Flag, "enabled", _("Enable Client Verification"), _("Require a client to pass at least one enabled verification method"));
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
      "tailscale-derp.verify.url_enabled": "1",
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
      "tailscale-derp.verify.tailscaled_enabled": "1",
    });

    o = s.option(form.Value, "tailscaled_socket", _("Custom tailscaled Socket"), _("Path to the local tailscaled socket"));
    o.rmempty = true;
    o.placeholder = "/var/run/tailscale/tailscaled.sock";
    o.validate = (_sectionId: string, value: string) => !value || validateUnixSocketPath("tailscaled socket path", value);
    o.depends({
      "tailscale-derp.verify.enabled": "1",
      "tailscale-derp.verify.tailscaled_enabled": "1",
      "tailscale-derp.verify.tailscaled_socket_enabled": "1",
    });

    o = s.option(form.Flag, "api_enabled", _("Enable Official API Verification"), _("Allow authorized, non-expired devices from configured Tailscale API instances"));
    o.default = "0";
    o.rmempty = false;
    o.depends("enabled", "1");

    o = s.option(form.Value, "sync_interval", _("API Sync Interval (seconds)"), _("How often to refresh configured Tailscale API instances"));
    o.default = "300";
    o.rmempty = false;
    o.datatype = "uinteger";
    o.depends("enabled", "1");

    o = s.option(form.Value, "cache_ttl", _("API Cache TTL (seconds)"), _("Cached devices older than this are not used for authentication"));
    o.default = "900";
    o.rmempty = false;
    o.datatype = "uinteger";
    o.depends("enabled", "1");

    const apiSection = m.section(
      form.GridSection,
      "verify_api",
      _("Official API Instances"),
      _("Add one instance per Tailscale API credential. Select Edit to configure credentials and optional DERP Map synchronization."),
    );
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

    o = apiSection.option(form.Flag, "derpmap_sync", _("Sync DERP Map"), _("Publish this router's mapped endpoint into this Tailnet policy. Credentials must have policy file write permission."));
    o.default = "0";
    o.rmempty = false;
    o.validate = validateDERPMapSync;

    o = apiSection.option(form.Value, "api_key", _("API Access Token"), _("Enter a new API access token; leave empty to keep the current value"));
    o.password = true;
    o.rmempty = true;
    o.placeholder = _("Leave empty to keep the current key");
    o.depends("auth_type", "api_key");
    preserveSecret(o, "api_key");
    modalOnly(o);

    o = apiSection.option(form.Value, "oauth_client_id", _("OAuth Client ID"), _("Enter a new client ID; leave empty to keep the current value"));
    o.rmempty = true;
    o.placeholder = _("Leave empty to keep the current client ID");
    o.depends("auth_type", "oauth");
    preserveSecret(o, "oauth_client_id");
    modalOnly(o);

    o = apiSection.option(form.Value, "oauth_client_secret", _("OAuth Client Secret"), _("Enter a new client secret; leave empty to keep the current value"));
    o.password = true;
    o.rmempty = true;
    o.placeholder = _("Leave empty to keep the current client secret");
    o.depends("auth_type", "oauth");
    preserveSecret(o, "oauth_client_secret");
    modalOnly(o);

    o = apiSection.option(form.Value, "region_id", _("Region ID"), _("Custom DERP region ID (900-999)"));
    o.placeholder = "900";
    o.datatype = "range(900,999)";
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;
    modalOnly(o);

    o = apiSection.option(form.Value, "region_code", _("Region Code"));
    o.placeholder = "openwrt-derp";
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;
    modalOnly(o);

    o = apiSection.option(form.Value, "region_name", _("Region Name"));
    o.placeholder = _("OpenWrt DERP Relay");
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;
    modalOnly(o);

    o = apiSection.option(form.Value, "node_name", _("Node Name"), _("Stable ownership key used to update or withdraw only this managed node"));
    o.placeholder = "900a";
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;
    modalOnly(o);

    o = apiSection.option(form.Value, "hostname", _("TLS Hostname"), _("Stable DNS name covered by the DERP server certificate"));
    o.placeholder = "derp.example.com";
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    o.validate = validateRequiredForDERPMap;
    modalOnly(o);

    o = apiSection.option(form.Value, "cert_name", _("Certificate Name"), _("Optional TLS certificate verification name when it differs from the hostname"));
    o.rmempty = true;
    o.depends("derpmap_sync", "1");
    modalOnly(o);

    return m.render();
  },
});
