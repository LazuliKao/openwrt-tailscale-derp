import {
	callSetDeviceIPv4,
	callTailnets,
	type TailnetInstance,
	type TailnetsResponse,
} from "@/shared/tailnets";

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
	error?: string;
};

type DevicesView = {
	tableBody: HTMLElement;
	countEl: HTMLElement;
	updatedEl: HTMLElement;
	messageEl: HTMLElement;
	instancesEl: HTMLElement;
	searchEl: HTMLInputElement;
	tailnetSelect: HTMLSelectElement;
	refreshEl: HTMLButtonElement;
	devices: Device[];
	tailnets: TailnetInstance[];
	selectedInstance: string;
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

function formatTime(value?: string): string {
	if (!value) return "-";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDeviceName(device: Device): string {
	return device.name || device.hostname || device.nodeId || _("Unnamed device");
}

function isIPv4(value: string): boolean {
	const octets = value.split(".");
	return (
		octets.length === 4 &&
		octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255)
	);
}

function deviceIPv4(device: Device): string {
	return device.addresses?.find(isIPv4) || "";
}
 
function formatOptionalBoolean(value?: boolean): string {
	if (value === undefined) return "-";
	return value ? _("Yes") : _("No");
}

function detailField(label: string, value: string | HTMLElement): HTMLElement {
	return (
		<div class="cbi-value">
			<label class="cbi-value-title">{label}</label>
			<div class="cbi-value-field">{value}</div>
		</div>
	);
}

function showDeviceDetails(device: Device): void {
	const nodeKey = device.nodeKey ? (
		<div>
			<code style="word-break: break-all;">{device.nodeKey}</code>{" "}
		</div>
	) : (
		"-"
	);

	ui.showModal(
		_("Device Details"),
		<>
			<div>
				{detailField(_("Name"), formatDeviceName(device))}
				{detailField(_("Hostname"), device.hostname || "-")}
				{detailField(_("User"), device.user || "-")}
				{detailField(_("Node ID"), device.nodeId || "-")}
				{detailField(_("Node Key"), nodeKey)}
				{detailField(
					_("Platform"),
					[device.os, device.clientVersion].filter(Boolean).join(" / ") || "-",
				)}
				{detailField(_("Addresses"), device.addresses?.join(", ") || "-")}
				{detailField(_("Last Seen"), formatTime(device.lastSeen))}
				{detailField(_("Key Expiry"), formatTime(device.expires))}
				{detailField(_("Tags"), device.tags?.join(", ") || "-")}
				{detailField(_("Sources"), device.sources?.join(", ") || "-")}
				{detailField(_("Authorized"), formatOptionalBoolean(device.authorized))}
				{detailField(
					_("Connected to Control"),
					formatOptionalBoolean(device.connectedToControl),
				)}
				{detailField(_("External"), formatOptionalBoolean(device.isExternal))}
				{detailField(_("Ephemeral"), formatOptionalBoolean(device.isEphemeral))}
				{detailField(
					_("Multiple Connections"),
					formatOptionalBoolean(device.multipleConnections),
				)}
			</div>{" "}
			<div style="margin-top: 0.75em; text-align: right;">
				<button
					class="cbi-button cbi-button-neutral"
					type="button"
					onclick={ui.hideModal}
				>
					{_("Close")}
				</button>
			</div>
		</>,
	);
}

function updateDeviceIPv4(
	viewState: DevicesView,
	device: Device,
	input: HTMLInputElement,
	button: HTMLButtonElement,
	messageEl: HTMLElement,
	onSuccess: () => void,
): void {
	const instance = viewState.selectedInstance;
	const ipv4 = input.value.trim();
	if (!instance) {
		messageEl.style.color = "#cf222e";
		messageEl.textContent = _(
			"Select an API instance before changing an address.",
		);
		return;
	}
	if (!device.nodeId || !isIPv4(ipv4)) {
		messageEl.style.color = "#cf222e";
		messageEl.textContent = _("Enter a valid IPv4 address.");
		return;
	}

	button.disabled = true;
	messageEl.style.color = "";
	messageEl.textContent = _("Updating device IPv4 address...");
	callSetDeviceIPv4(instance, device.nodeId, ipv4)
		.then((result) => {
			if (result?.error) throw new Error(result.error);
			return callDevices();
		})
		.then((data) => {
			applyData(viewState, data || {});
			viewState.messageEl.style.color = "#1a7f37";
			viewState.messageEl.textContent = _("Device IPv4 address updated.");
			onSuccess();
		})
		.catch((err: unknown) => {
			messageEl.style.color = "#cf222e";
			messageEl.textContent =
				err instanceof Error
					? err.message
					: _("Unable to update device IPv4 address.");
		})
		.finally(() => {
			button.disabled = false;
		});
}

function showDeviceEditor(viewState: DevicesView, device: Device): void {
	const input = (
		<input
			class="cbi-input-text"
			type="text"
			value={deviceIPv4(device)}
			placeholder="100.64.0.1"
			style="width: 100%; box-sizing: border-box;"
		/>
	) as HTMLInputElement;
	const messageEl = <div style="min-height: 1.2em; margin-top: 0.75em;"></div>;
	const saveButton = (
		<button class="cbi-button cbi-button-save" type="button">
			{_("Save")}
		</button>
	) as HTMLButtonElement;
	saveButton.disabled = !device.nodeId;
	saveButton.onclick = () =>
		updateDeviceIPv4(
			viewState,
			device,
			input,
			saveButton,
			messageEl,
			ui.hideModal,
		);

	ui.showModal(
		_("Edit Device"),
		<div>
			<p>
				{_(
					"Change the IPv4 address for this device through the selected API instance.",
				)}
			</p>
			{detailField(_("Device"), formatDeviceName(device))}
			<div class="cbi-value">
				<label class="cbi-value-title">{_("IPv4 Address")}</label>
				<div class="cbi-value-field">{input}</div>
			</div>
			{messageEl}
			<div style="margin-top: 0.75em; text-align: right;">
				<button
					class="cbi-button cbi-button-neutral"
					type="button"
					onclick={ui.hideModal}
				>
					{_("Cancel")}
				</button>{" "}
				{saveButton}
			</div>
		</div>,
	);
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
				<td class="td" colSpan={5} style="text-align: center;">
					{query ? _("No matching devices") : _("No devices available")}
				</td>
			</tr>,
		];
	}

	return devices.map((device) => {
		const status = device.authorized ? _("Authorized") : _("Not authorized");
		const statusColor = device.authorized ? "#1a7f37" : "#c60";
		const detailsButton = (
			<button class="cbi-button cbi-button-action" type="button">
				{_("Details")}
			</button>
		) as HTMLButtonElement;
		const editButton = (
			<button class="cbi-button cbi-button-save" type="button">
				{_("Edit")}
			</button>
		) as HTMLButtonElement;
		detailsButton.onclick = () => showDeviceDetails(device);
		editButton.disabled = !device.nodeId;
		editButton.onclick = () => showDeviceEditor(viewState, device);

		return (
			<tr class="tr">
				<td class="td" style={`color: ${statusColor}; white-space: nowrap;`}>
					{status}
				</td>
				<td class="td">
					<strong>{formatDeviceName(device)}</strong>
					{device.hostname && device.hostname !== formatDeviceName(device) ? (
						<small style="display: block;">{device.hostname}</small>
					) : null}
					{device.user ? (
						<small style="display: block;">{device.user}</small>
					) : null}
				</td>
				<td class="td" style="font-family: monospace; white-space: nowrap;">
					{deviceIPv4(device) || "-"}
				</td>
				<td class="td">{formatTime(device.lastSeen)}</td>
				<td class="td" style="white-space: nowrap;">
					{detailsButton} {editButton}
				</td>
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
				<strong>
					{instance.label || instance.name || _("Unnamed instance")}
				</strong>
				{" - "}
				{instance.tailnet || "-"}
				{" - "}
				<span style={`color: ${stateColor};`}>{state}</span>
				{" - "}
				{_("%d device(s)").format(instance.deviceCount || 0)}
				{instance.error ? (
					<span style="color: #cf222e;">{` - ${instance.error}`}</span>
				) : null}
			</div>
		);
	});
}

function applyTailnets(viewState: DevicesView, data: TailnetsResponse): void {
	viewState.tailnets = (data.instances || []).filter(
		(instance) => instance.configured && instance.name,
	);
	const previous = viewState.selectedInstance;
	viewState.tailnetSelect.replaceChildren(
		<option value="">{_("Select an API instance")}</option>,
		...viewState.tailnets.map((instance) => (
			<option value={instance.name || ""}>
				{instance.label || instance.name}
			</option>
		)),
	);
	viewState.tailnetSelect.value = viewState.tailnets.some(
		(instance) => instance.name === previous,
	)
		? previous
		: "";
	viewState.selectedInstance = viewState.tailnetSelect.value;
	viewState.updateTable();
}

function applyData(viewState: DevicesView, data: DevicesResponse): void {
	viewState.devices = data?.devices || [];
	viewState.countEl.textContent = _("%d device(s)").format(
		viewState.devices.length,
	);
	viewState.updatedEl.textContent = _("Last updated: %s").format(
		new Date().toLocaleTimeString(),
	);
	viewState.instancesEl.replaceChildren(
		...renderInstances(data?.instances || []),
	);
	viewState.updateTable();
}

function pollDevices(viewState: DevicesView): Promise<void> {
	return callDevices()
		.then((data) => {
			if (data?.error) throw new Error(data.error);
			viewState.messageEl.textContent = "";
			applyData(viewState, data || {});
		})
		.catch((err: unknown) => {
			viewState.messageEl.textContent =
				err instanceof Error ? err.message : _("Backend unavailable");
		});
}

export const main = (view as any).extend({
	load() {
		return Promise.all([
			callDevices().catch(() => ({ devices: [], instances: [] })),
			callTailnets().catch(() => ({ instances: [] })),
		]);
	},

	render(this: DevicesView, data: [DevicesResponse, TailnetsResponse]) {
		const tableBody = <tbody></tbody>;
		const countEl = <div style="margin-bottom: 0.5em;"></div>;
		const updatedEl = (
			<div style="font-size: 0.9em; margin-bottom: 0.5em;"></div>
		);
		const messageEl = (
			<div style="color: #cf222e; min-height: 1.2em; margin-bottom: 0.5em;"></div>
		);
		const instancesEl = <div></div>;
		const searchEl = (
			<input
				class="cbi-input-text"
				type="search"
				placeholder={_("Search devices...")}
				style="width: 100%;"
			/>
		) as HTMLInputElement;
		const tailnetSelect = (
			<select class="cbi-input-select" style="min-width: 18em;"></select>
		) as HTMLSelectElement;
		const refreshEl = (
			<button class="cbi-button cbi-button-action" type="button">
				{_("Refresh")}
			</button>
		) as HTMLButtonElement;

		const viewState: DevicesView = {
			tableBody,
			countEl,
			updatedEl,
			messageEl,
			instancesEl,
			searchEl,
			tailnetSelect,
			refreshEl,
			devices: [],
			tailnets: [],
			selectedInstance: "",
			updateTable: () => undefined,
		};

		viewState.updateTable = () => {
			viewState.tableBody.replaceChildren(...buildRows(viewState));
		};
		searchEl.oninput = viewState.updateTable;
		tailnetSelect.onchange = () => {
			viewState.selectedInstance = tailnetSelect.value;
			viewState.updateTable();
		};
		refreshEl.onclick = () => {
			refreshEl.disabled = true;
			messageEl.style.color = "";
			messageEl.textContent = _("Refreshing Official API devices...");
			callRefreshDevices()
				.then((result) => {
					if (result?.error) throw new Error(result.error);
					messageEl.style.color = "#1a7f37";
					messageEl.textContent = _("Device data refreshed.");
					applyData(viewState, result || {});
				})
				.catch((err: unknown) => {
					messageEl.style.color = "#cf222e";
					messageEl.textContent =
						err instanceof Error ? err.message : _("Refresh failed");
				})
				.finally(() => {
					refreshEl.disabled = false;
				});
		};

		applyTailnets(viewState, data[1] || {});
		applyData(viewState, data[0] || {});
		poll.add(() => pollDevices(viewState), 15);

		return (
			<div>
				<h2>{_("Tailscale Devices")}</h2>
				<div class="cbi-section">
					<h3>{_("Official API Synchronization")}</h3>
					{instancesEl}
					{updatedEl}
					<div style="margin-bottom: 0.75em;">
						<label>{_("API instance for device edits")}</label>
						<br />
						{tailnetSelect}
					</div>
					{refreshEl} {messageEl}
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
									<th class="th">{_("IPv4")}</th>
									<th class="th">{_("Last Seen")}</th>
									<th class="th">{_("Actions")}</th>
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
