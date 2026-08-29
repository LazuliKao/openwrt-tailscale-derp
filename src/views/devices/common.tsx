import type { Device, DeviceOrigin } from "@/shared/devices";

export function formatTime(value?: string): string {
	if (!value) return "-";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatDeviceName(device: Device): string {
	return device.name || device.hostname || device.nodeId || _("Unnamed device");
}

export function isIPv4(value: string): boolean {
	const octets = value.split(".");
	return (
		octets.length === 4 &&
		octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255)
	);
}

export function deviceIPv4(device: Device): string {
	return device.addresses?.find(isIPv4) || "";
}

export function formatOptionalBoolean(value?: boolean): string {
	if (value === undefined) return "-";
	return value ? _("Yes") : _("No");
}

export function detailField(label: string, value: string | HTMLElement): HTMLElement {
	return (
		<div class="cbi-value">
			<label class="cbi-value-title">{label}</label>
			<div class="cbi-value-field">{value}</div>
		</div>
	);
}

export function splitValues(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function deviceOrigins(device: Device): DeviceOrigin[] {
	return (device.origins || []).filter(
		(origin) => origin.instance && origin.nodeId,
	);
}

export function formatOrigin(origin: DeviceOrigin): string {
	return origin.label || origin.instance;
}

export function setMessage(element: HTMLElement, message: string, error = false): void {
	element.style.color = error ? "#cf222e" : "#1a7f37";
	element.textContent = message;
}
