type Device = {
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
	tags?: string[];
	isExternal?: boolean;
	isEphemeral?: boolean;
	multipleConnections?: boolean;
	sources?: string[];
};

type DeviceSyncStatus = {
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

type DevicesResponse = {
	devices?: Device[];
	instances?: DeviceSyncStatus[];
};

type DevicesView = {
	tableBody: HTMLElement;
	countEl: HTMLElement;
	updatedEl: HTMLElement;
	messageEl: HTMLElement;
	instancesEl: HTMLElement;
	searchEl: HTMLInputElement;
	refreshEl: HTMLButtonElement;
	devices: Device[];
	updateTable: () => void;
};

const view = L.view;
const rpc = L.rpc;
const ui = L.ui;
const poll = L.Poll;

const callDevices = rpc.declare<DevicesResponse>({
	object: "luci.tailscale-derp",
	method: "get_devices",
});

const callRefreshDevices = rpc.declare<DevicesResponse>({
	object: "luci.tailscale-derp",
	method: "refresh_devices",
});

function truncate(value: string, length = 20): string {
	return value.length > length ? `${value.substring(0, length)}...` : value;
}

function formatTime(value?: string): string {
	if (!value) return "-";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDeviceName(device: Device): string {
	return device.name || device.hostname || device.nodeId || _("Unnamed device");
}

function buildRows(viewState: DevicesView): HTMLElement[] {
	const query = viewState.searchEl.value.trim().toLowerCase();
	const devices = viewState.devices.filter((device) => {
		if (!query) return true;
		return [
			device.name,
			device.hostname,
			device.user,
			device.nodeId,
			device.nodeKey,
			...(device.tags || []),
		].some((value) => value?.toLowerCase().includes(query));
	});

	if (devices.length === 0) {
		return [
			<tr class="tr">
				<td class="td" colSpan={8} style="text-align: center;">
					{query ? _("No matching devices") : _("No devices available")}
				</td>
			</tr>,
		];
	}

	return devices.map((device) => {
		const key = device.nodeKey || "-";
		const status = device.authorized ? _("Authorized") : _("Not authorized");
		const statusColor = device.authorized ? "#1a7f37" : "#c60";
		const copyButton = device.nodeKey ? (
			<button
				class="cbi-button cbi-button-action"
				type="button"
				onclick={() => {
					navigator.clipboard.writeText(device.nodeKey || "").then(() => {
						ui.addNotification(null, <p>{_("Node key copied")}</p>);
					}).catch(() => {
						ui.addNotification(null, <p>{_("Unable to copy node key")}</p>);
					});
				}}
			>
				{_("Copy")}
			</button>
		) : null;

		return (
			<tr class="tr">
				<td class="td" style={`color: ${statusColor}; white-space: nowrap;`}>{status}</td>
				<td class="td">
					<strong>{formatDeviceName(device)}</strong>
					{device.hostname && device.hostname !== formatDeviceName(device) ? <small style="display: block;">{device.hostname}</small> : null}
				</td>
				<td class="td" style="font-family: monospace; white-space: nowrap;" title={key}>
					{truncate(key)} {copyButton}
				</td>
				<td class="td">{device.user || "-"}</td>
				<td class="td">{[device.os, device.clientVersion].filter(Boolean).join(" / ") || "-"}</td>
				<td class="td">{device.addresses?.join(", ") || "-"}</td>
				<td class="td">{formatTime(device.lastSeen)}</td>
				<td class="td">{device.sources?.join(", ") || "-"}</td>
			</tr>
		);
	});
}

function renderInstances(instances: DeviceSyncStatus[]): HTMLElement[] {
	if (instances.length === 0) {
		return [<p>{_("No Official API instances are configured.")}</p>];
	}
	return instances.map((instance) => {
		const state = !instance.configured
			? _("Not configured")
			: instance.fresh
				? _("Fresh")
				: _("Stale or not synchronized");
		const stateColor = instance.fresh ? "#1a7f37" : "#c60";
		return (
			<div class="cbi-section-node" style="margin-bottom: 0.5em;">
				<strong>{instance.label || instance.name || _("Unnamed instance")}</strong>
				{" - "}{instance.tailnet || "-"}{" - "}
				<span style={`color: ${stateColor};`}>{state}</span>
				{" - "}{_('%d device(s)').format(instance.deviceCount || 0)}
				{instance.error ? <span style="color: #cf222e;">{` - ${instance.error}`}</span> : null}
			</div>
		);
	});
}

function applyData(viewState: DevicesView, data: DevicesResponse): void {
	viewState.devices = data?.devices || [];
	viewState.countEl.textContent = _("%d device(s)").format(viewState.devices.length);
	viewState.updatedEl.textContent = _("Last updated: %s").format(new Date().toLocaleTimeString());
	viewState.instancesEl.replaceChildren(...renderInstances(data?.instances || []));
	viewState.updateTable();
}

function pollDevices(viewState: DevicesView): Promise<void> {
	return callDevices()
		.then((data) => {
			viewState.messageEl.textContent = "";
			applyData(viewState, data || {});
		})
		.catch((err: unknown) => {
			viewState.messageEl.textContent = err instanceof Error ? err.message : _("Backend unavailable");
		});
}

export const main = (view as any).extend({
	load() {
		return callDevices().catch(() => ({ devices: [], instances: [] }));
	},

	render(this: DevicesView, data: DevicesResponse) {
		const tableBody = <tbody></tbody>;
		const countEl = <div style="margin-bottom: 0.5em;"></div>;
		const updatedEl = <div style="font-size: 0.9em; margin-bottom: 0.5em;"></div>;
		const messageEl = <div style="color: #cf222e; min-height: 1.2em; margin-bottom: 0.5em;"></div>;
		const instancesEl = <div></div>;
		const searchEl = <input class="cbi-input-text" type="search" placeholder={_("Search devices...")} style="width: 100%;" /> as HTMLInputElement;
		const refreshEl = <button class="cbi-button cbi-button-action" type="button">{_("Refresh")}</button> as HTMLButtonElement;

		const viewState: DevicesView = {
			tableBody,
			countEl,
			updatedEl,
			messageEl,
			instancesEl,
			searchEl,
			refreshEl,
			devices: [],
			updateTable: () => undefined,
		};

		viewState.updateTable = () => {
			viewState.tableBody.replaceChildren(...buildRows(viewState));
		};
		searchEl.oninput = viewState.updateTable;
		refreshEl.onclick = () => {
			refreshEl.disabled = true;
			messageEl.style.color = "";
			messageEl.textContent = _("Refreshing Official API devices...");
			callRefreshDevices()
				.then((result) => {
					messageEl.style.color = "#1a7f37";
					messageEl.textContent = _("Device data refreshed.");
					applyData(viewState, result || {});
				})
				.catch((err: unknown) => {
					messageEl.style.color = "#cf222e";
					messageEl.textContent = err instanceof Error ? err.message : _("Refresh failed");
				})
				.finally(() => {
					refreshEl.disabled = false;
				});
		};

		applyData(viewState, data || {});
		poll.add(() => pollDevices(viewState), 15);

		return (
			<div>
				<h2>{_("Tailscale Devices")}</h2>
				<div class="cbi-section">
					<h3>{_("Official API Synchronization")}</h3>
					{instancesEl}
					{updatedEl}
					{refreshEl}{" "}{messageEl}
				</div>
				<div class="cbi-section">
					<h3>{_("Devices")}</h3>
					{countEl}
					<div style="margin-bottom: 0.75em;">{searchEl}</div>
					<div style="overflow-x: auto;">
						<table class="table">
							<thead>
								<tr class="tr">
									<th class="th">{_("Status")}</th>
									<th class="th">{_("Device")}</th>
									<th class="th">{_("Node Key")}</th>
									<th class="th">{_("User")}</th>
									<th class="th">{_("Platform")}</th>
									<th class="th">{_("Addresses")}</th>
									<th class="th">{_("Last Seen")}</th>
									<th class="th">{_("Sources")}</th>
								</tr>
							</thead>
							{tableBody}
						</table>
					</div>
				</div>
			</div>
		);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
});
