import type { Device } from "@/shared/devices";
import type { DeviceDialogActions } from "./dialogs";
import { showDeviceDetails, showDeviceEditor } from "./dialogs";
import { deviceIPv4, formatDeviceName, formatTime } from "./common";

export function buildDeviceRows(
	devices: Device[],
	query: string,
	actions: DeviceDialogActions,
): HTMLElement[] {
	const normalizedQuery = query.trim().toLowerCase();
	const matching = devices.filter((device) => {
		if (!normalizedQuery) return true;
		return [
			device.name,
			device.hostname,
			device.user,
			device.nodeId,
			device.nodeKey,
			...(device.tags || []),
		].some((value) => value?.toLowerCase().includes(normalizedQuery));
	});
	if (matching.length === 0) {
		return [
			<tr class="tr">
				<td class="td" colSpan={5} style="text-align: center;">
					{normalizedQuery ? _("No matching devices") : _("No devices available")}
				</td>
			</tr>,
		];
	}
	return matching.map((device) => {
		const status = device.authorized ? _("Authorized") : _("Not authorized");
		const statusColor = device.authorized ? "#1a7f37" : "#c60";
		const detailsButton = <button class="cbi-button cbi-button-action" type="button">{_("Details")}</button> as HTMLButtonElement;
		const editButton = <button class="cbi-button cbi-button-save" type="button">{_("Manage")}</button> as HTMLButtonElement;
		detailsButton.onclick = () => showDeviceDetails(device);
		editButton.onclick = () => showDeviceEditor(device, actions);
		return (
			<tr class="tr">
				<td class="td" style={`color: ${statusColor}; white-space: nowrap;`}>{status}</td>
				<td class="td">
					<strong>{formatDeviceName(device)}</strong>
					{device.hostname && device.hostname !== formatDeviceName(device) ? <small style="display: block;">{device.hostname}</small> : null}
					{device.user ? <small style="display: block;">{device.user}</small> : null}
				</td>
				<td class="td" style="font-family: monospace; white-space: nowrap;">{deviceIPv4(device) || "-"}</td>
				<td class="td">{formatTime(device.lastSeen)}</td>
				<td class="td" style="white-space: nowrap;">{detailsButton} {editButton}</td>
			</tr>
		);
	});
}
