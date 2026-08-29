export type DeviceOrigin = {
	instance: string;
	label?: string;
	nodeId: string;
};

export type Device = {
	nodeId?: string;
	nodeKey?: string;
	name?: string;
	hostname?: string;
	user?: string;
	addresses?: string[];
	os?: string;
	clientVersion?: string;
	authorized?: boolean;
	connectedToControl?: boolean;
	lastSeen?: string;
	expires?: string;
	keyExpiryDisabled?: boolean;
	tags?: string[];
	isExternal?: boolean;
	isEphemeral?: boolean;
	multipleConnections?: boolean;
	sources?: string[];
	origins?: DeviceOrigin[];
};

export type DeviceSyncStatus = {
	name?: string;
	label?: string;
	tailnet?: string;
	configured?: boolean;
	fresh?: boolean;
	lastAttempt?: string;
	lastSuccess?: string;
	deviceCount?: number;
	error?: string;
};

export type DevicesResponse = {
	devices?: Device[];
	instances?: DeviceSyncStatus[];
	error?: string;
};

export type DeviceRoutesResponse = {
	advertisedRoutes?: string[];
	enabledRoutes?: string[];
	error?: string;
};

export type DeviceAttributesResponse = {
	attributes?: Record<string, unknown>;
	expiries?: Record<string, string>;
	error?: string;
};

export type DeviceActionResponse = {
	result?: string;
	error?: string;
};

const rpc = L.rpc;

export const callDevices = rpc.declare<DevicesResponse>({
	object: "luci.tailscale-derp",
	method: "get_devices",
	reject: true,
});

export const callRefreshDevices = rpc.declare<DevicesResponse>({
	object: "luci.tailscale-derp",
	method: "refresh_devices",
	reject: true,
});

export const callSetDeviceIPv4 = rpc.declare<
	DeviceActionResponse,
	[string, string, string]
>({
	object: "luci.tailscale-derp",
	method: "set_device_ipv4",
	params: ["instance", "device_id", "ipv4"],
	reject: true,
});

export const callSetDeviceAuthorized = rpc.declare<
	DeviceActionResponse,
	[string, string, boolean]
>({
	object: "luci.tailscale-derp",
	method: "set_device_authorized",
	params: ["instance", "device_id", "authorized"],
	reject: true,
});

export const callSetDeviceName = rpc.declare<
	DeviceActionResponse,
	[string, string, string]
>({
	object: "luci.tailscale-derp",
	method: "set_device_name",
	params: ["instance", "device_id", "name"],
	reject: true,
});

export const callSetDeviceTags = rpc.declare<
	DeviceActionResponse,
	[string, string, string[]]
>({
	object: "luci.tailscale-derp",
	method: "set_device_tags",
	params: ["instance", "device_id", "tags"],
	reject: true,
});

export const callSetDeviceKey = rpc.declare<
	DeviceActionResponse,
	[string, string, boolean]
>({
	object: "luci.tailscale-derp",
	method: "set_device_key",
	params: ["instance", "device_id", "key_expiry_disabled"],
	reject: true,
});

export const callDeleteDevice = rpc.declare<DeviceActionResponse, [string, string]>({
	object: "luci.tailscale-derp",
	method: "delete_device",
	params: ["instance", "device_id"],
	reject: true,
});

export const callExpireDevice = rpc.declare<DeviceActionResponse, [string, string]>({
	object: "luci.tailscale-derp",
	method: "expire_device",
	params: ["instance", "device_id"],
	reject: true,
});

export const callDeviceRoutes = rpc.declare<DeviceRoutesResponse, [string, string]>({
	object: "luci.tailscale-derp",
	method: "get_device_routes",
	params: ["instance", "device_id"],
	reject: true,
});

export const callSetDeviceRoutes = rpc.declare<
	DeviceActionResponse,
	[string, string, string[]]
>({
	object: "luci.tailscale-derp",
	method: "set_device_routes",
	params: ["instance", "device_id", "routes"],
	reject: true,
});

export const callDeviceAttributes = rpc.declare<
	DeviceAttributesResponse,
	[string, string]
>({
	object: "luci.tailscale-derp",
	method: "get_device_attributes",
	params: ["instance", "device_id"],
	reject: true,
});

export const callSetDeviceAttribute = rpc.declare<
	DeviceActionResponse,
	[string, string, string, string, string, string]
>({
	object: "luci.tailscale-derp",
	method: "set_device_attribute",
	params: ["instance", "device_id", "key", "value", "expiry", "comment"],
	reject: true,
});

export const callDeleteDeviceAttribute = rpc.declare<
	DeviceActionResponse,
	[string, string, string]
>({
	object: "luci.tailscale-derp",
	method: "delete_device_attribute",
	params: ["instance", "device_id", "key"],
	reject: true,
});
