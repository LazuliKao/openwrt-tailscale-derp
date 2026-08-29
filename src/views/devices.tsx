import {
	callDevices,
	callRefreshDevices,
	type Device,
	type DeviceSyncStatus,
	type DevicesResponse,
} from "@/shared/devices";
import { setMessage } from "./devices/common";
import type { DeviceDialogActions } from "./devices/dialogs";
import { buildDeviceRows } from "./devices/rows";

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
	refresh: () => Promise<void>;
};

const view = L.view;
const poll = L.Poll;

function renderInstances(instances: DeviceSyncStatus[]): HTMLElement[] {
	if (instances.length === 0) return [<p>{_("No Official API instances are configured.")}</p>];
	return instances.map((instance) => {
		const state = !instance.configured ? _("Not configured") : instance.fresh ? _("Fresh") : _("Stale or not synchronized");
		const stateColor = instance.fresh ? "#1a7f37" : "#c60";
		return (
			<div class="cbi-section-node" style="margin-bottom: 0.5em;">
				<strong>{instance.label || instance.name || _("Unnamed instance")}</strong>{" - "}{instance.tailnet || "-"}{" - "}
				<span style={`color: ${stateColor};`}>{state}</span>{" - "}
				{_("%d device(s)").format(instance.deviceCount || 0)}
				{instance.error ? <span style="color: #cf222e;">{` - ${instance.error}`}</span> : null}
			</div>
		);
	});
}

function applyData(viewState: DevicesView, data: DevicesResponse): void {
	viewState.devices = data.devices || [];
	viewState.countEl.textContent = _("%d device(s)").format(viewState.devices.length);
	viewState.updatedEl.textContent = _("Last updated: %s").format(new Date().toLocaleTimeString());
	viewState.instancesEl.replaceChildren(...renderInstances(data.instances || []));
	viewState.updateTable();
}

function loadDevices(viewState: DevicesView): Promise<void> {
	return callDevices()
		.then((data) => {
			if (data?.error) throw new Error(data.error);
			applyData(viewState, data || {});
		})
		.catch((error: unknown) => {
			setMessage(viewState.messageEl, error instanceof Error ? error.message : _("Backend unavailable"), true);
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
		const messageEl = <div style="min-height: 1.2em; margin-bottom: 0.5em;"></div>;
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
			refresh: () => Promise.resolve(),
		};
		const actions: DeviceDialogActions = {
			refresh: () => loadDevices(viewState),
			notify: (message, error = false) => setMessage(messageEl, message, error),
		};
		viewState.updateTable = () => tableBody.replaceChildren(...buildDeviceRows(viewState.devices, searchEl.value, actions));
		viewState.refresh = () => loadDevices(viewState);
		searchEl.oninput = viewState.updateTable;
		refreshEl.onclick = () => {
			refreshEl.disabled = true;
			messageEl.style.color = "";
			messageEl.textContent = _("Refreshing Official API devices...");
			callRefreshDevices()
				.then((result) => {
					if (result?.error) throw new Error(result.error);
					applyData(viewState, result || {});
					setMessage(messageEl, _("Device data refreshed."));
				})
				.catch((error: unknown) => setMessage(messageEl, error instanceof Error ? error.message : _("Refresh failed"), true))
				.finally(() => { refreshEl.disabled = false; });
		};
		applyData(viewState, data || {});
		poll.add(() => loadDevices(viewState), 15);
		return (
			<div>
				<h2>{_("Tailscale Devices")}</h2>
				<div class="cbi-section"><h3>{_("Official API Synchronization")}</h3>{instancesEl}{updatedEl}{refreshEl} {messageEl}</div>
				<div class="cbi-section">
					<h3>{_("Devices")}</h3>
					{countEl}
					<div style="margin-bottom: 0.75em;">{searchEl}</div>
					<div style="overflow-x: auto;"><table class="table"><thead><tr class="tr"><th class="th">{_("Status")}</th><th class="th">{_("Device")}</th><th class="th">{_("IPv4")}</th><th class="th">{_("Last Seen")}</th><th class="th">{_("Actions")}</th></tr></thead>{tableBody}</table></div>
				</div>
			</div>
		);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
});
