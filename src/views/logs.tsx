declare const views: {
	LogreadBox(logtag: string, name: string): unknown;
};

export const main = views.LogreadBox("tailscale-derp", _("Tailscale DERP Log"));
