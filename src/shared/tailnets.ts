export type TailnetInstance = {
	name?: string;
	label?: string;
	tailnet?: string;
	configured?: boolean;
};

export type TailnetsResponse = {
	instances?: TailnetInstance[];
	error?: string;
};

export type TailnetACLResponse = {
	hujson?: string;
	etag?: string;
	error?: string;
	conflict?: boolean;
};

export type TailnetActionResponse = {
	result?: string;
	valid?: boolean;
	etag?: string;
	error?: string;
	conflict?: boolean;
};

const rpc = L.rpc;

export const callTailnets = rpc.declare<TailnetsResponse>({
	object: "luci.tailscale-derp",
	method: "get_tailnets",
	reject: true,
});

export const callTailnetACL = rpc.declare<TailnetACLResponse, [string]>({
	object: "luci.tailscale-derp",
	method: "get_tailnet_acl",
	params: ["instance"],
	reject: true,
});

export const callValidateTailnetACL = rpc.declare<TailnetActionResponse, [string, string]>({
	object: "luci.tailscale-derp",
	method: "validate_tailnet_acl",
	params: ["instance", "hujson"],
	reject: true,
});

export const callSetTailnetACL = rpc.declare<TailnetActionResponse, [string, string, string]>({
	object: "luci.tailscale-derp",
	method: "set_tailnet_acl",
	params: ["instance", "hujson", "etag"],
	reject: true,
});
