import {
	callDeleteDevice,
	callDeleteDeviceAttribute,
	callDeviceAttributes,
	callDeviceRoutes,
	callExpireDevice,
	callSetDeviceAttribute,
	callSetDeviceAuthorized,
	callSetDeviceIPv4,
	callSetDeviceKey,
	callSetDeviceName,
	callSetDeviceRoutes,
	callSetDeviceTags,
	type Device,
	type DeviceActionResponse,
	type DeviceOrigin,
} from "@/shared/devices";
import {
	detailField,
	deviceIPv4,
	deviceOrigins,
	formatDeviceName,
	formatOptionalBoolean,
	formatOrigin,
	formatTime,
	isIPv4,
	setMessage,
	splitValues,
} from "./common";

const ui = L.ui;

export type DeviceDialogActions = {
	refresh: () => Promise<void>;
	notify: (message: string, error?: boolean) => void;
};

function actionError(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function runAction(
	button: HTMLButtonElement,
	messageEl: HTMLElement,
	request: () => Promise<DeviceActionResponse>,
	actions: DeviceDialogActions,
	success: string,
	onSuccess?: () => void,
): void {
	button.disabled = true;
	messageEl.textContent = _("Saving...");
	messageEl.style.color = "";
	request()
		.then((result) => {
			if (result?.error) throw new Error(result.error);
			return actions.refresh();
		})
		.then(() => {
			setMessage(messageEl, success);
			actions.notify(success);
			onSuccess?.();
		})
		.catch((error: unknown) => {
			setMessage(messageEl, actionError(error, _("Device update failed.")), true);
		})
		.finally(() => {
			button.disabled = false;
		});
}

function targetSelector(device: Device): {
	element: HTMLElement;
	selected: () => DeviceOrigin | undefined;
	select?: HTMLSelectElement;
} {
	const origins = deviceOrigins(device);
	if (origins.length === 0) {
		return {
			element: <p style="color: #cf222e;">{_("No API source is available for this device.")}</p>,
			selected: () => undefined,
		};
	}
	if (origins.length === 1) {
		return {
			element: detailField(_("API Instance"), formatOrigin(origins[0])),
			selected: () => origins[0],
		};
	}
	const select = (
		<select class="cbi-input-select">
			{origins.map((origin) => (
				<option value={`${origin.instance}\u0000${origin.nodeId}`}>
					{formatOrigin(origin)}
				</option>
			))}
		</select>
	) as HTMLSelectElement;
	return {
		element: (
			<div class="cbi-value">
				<label class="cbi-value-title">{_("API Instance")}</label>
				<div class="cbi-value-field">{select}</div>
			</div>
		),
		selected: () => origins.find((origin) => `${origin.instance}\u0000${origin.nodeId}` === select.value),
		select,
	};
}

function noTarget(messageEl: HTMLElement): void {
	setMessage(messageEl, _("No API source is available for this device."), true);
}

function confirmation(title: string, message: string, action: () => void): void {
	const confirmButton = (
		<button class="cbi-button cbi-button-negative" type="button">
			{_("Confirm")}
		</button>
	) as HTMLButtonElement;
	confirmButton.onclick = action;
	ui.showModal(
		title,
		<div>
			<p>{message}</p>
			<div style="margin-top: 0.75em; text-align: right;">
				<button class="cbi-button cbi-button-neutral" type="button" onclick={ui.hideModal}>
					{_("Cancel")}
				</button>{" "}
				{confirmButton}
			</div>
		</div>,
	);
}

function runDangerousAction(
	title: string,
	message: string,
	request: () => Promise<DeviceActionResponse>,
	actions: DeviceDialogActions,
	success: string,
): void {
	confirmation(title, message, () => {
		ui.hideModal();
		request()
			.then((result) => {
				if (result?.error) throw new Error(result.error);
				return actions.refresh();
			})
			.then(() => actions.notify(success))
			.catch((error: unknown) => actions.notify(actionError(error, _("Device update failed.")), true));
	});
}

export function showDeviceDetails(device: Device): void {
	const nodeKey = device.nodeKey ? (
		<code style="word-break: break-all;">{device.nodeKey}</code>
	) : (
		"-"
	);
	ui.showModal(
		_("Device Details"),
		<div>
			{detailField(_("Name"), formatDeviceName(device))}
			{detailField(_("Hostname"), device.hostname || "-")}
			{detailField(_("User"), device.user || "-")}
			{detailField(_("Node ID"), device.nodeId || "-")}
			{detailField(_("Node Key"), nodeKey)}
			{detailField(_("Platform"), [device.os, device.clientVersion].filter(Boolean).join(" / ") || "-")}
			{detailField(_("Addresses"), device.addresses?.join(", ") || "-")}
			{detailField(_("Last Seen"), formatTime(device.lastSeen))}
			{detailField(_("Key Expiry"), device.keyExpiryDisabled ? _("Disabled") : formatTime(device.expires))}
			{detailField(_("Tags"), device.tags?.join(", ") || "-")}
			{detailField(_("Sources"), device.sources?.join(", ") || "-")}
			{detailField(_("Authorized"), formatOptionalBoolean(device.authorized))}
			{detailField(_("Connected to Control"), formatOptionalBoolean(device.connectedToControl))}
			{detailField(_("External"), formatOptionalBoolean(device.isExternal))}
			{detailField(_("Ephemeral"), formatOptionalBoolean(device.isEphemeral))}
			{detailField(_("Multiple Connections"), formatOptionalBoolean(device.multipleConnections))}
			<div style="margin-top: 0.75em; text-align: right;">
				<button class="cbi-button cbi-button-neutral" type="button" onclick={ui.hideModal}>
					{_("Close")}
				</button>
			</div>
		</div>,
	);
}

export function showDeviceEditor(device: Device, actions: DeviceDialogActions): void {
	const target = targetSelector(device);
	const nameInput = <input class="cbi-input-text" type="text" value={device.name || ""} /> as HTMLInputElement;
	const ipv4Input = <input class="cbi-input-text" type="text" value={deviceIPv4(device)} placeholder="100.64.0.1" /> as HTMLInputElement;
	const tagsInput = <textarea class="cbi-input-text" rows={3}></textarea> as HTMLTextAreaElement;
	tagsInput.value = (device.tags || []).join("\n");
	const authorizedInput = <input type="checkbox" /> as HTMLInputElement;
	authorizedInput.checked = Boolean(device.authorized);
	const keyExpiryInput = <input type="checkbox" /> as HTMLInputElement;
	keyExpiryInput.checked = Boolean(device.keyExpiryDisabled);
	const messageEl = <div style="min-height: 1.2em; margin-top: 0.75em;"></div>;
	const saveName = <button class="cbi-button cbi-button-save" type="button">{_("Save Name")}</button> as HTMLButtonElement;
	const saveIPv4 = <button class="cbi-button cbi-button-save" type="button">{_("Save IPv4")}</button> as HTMLButtonElement;
	const saveTags = <button class="cbi-button cbi-button-save" type="button">{_("Save Tags")}</button> as HTMLButtonElement;
	const saveAuthorized = <button class="cbi-button cbi-button-save" type="button">{_("Save Authorization")}</button> as HTMLButtonElement;
	const saveKey = <button class="cbi-button cbi-button-save" type="button">{_("Save Key Setting")}</button> as HTMLButtonElement;

	saveName.onclick = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		const name = nameInput.value.trim();
		if (!name) return setMessage(messageEl, _("Device name is required."), true);
		runAction(saveName, messageEl, () => callSetDeviceName(origin.instance, origin.nodeId, name), actions, _("Device name updated."));
	};
	saveIPv4.onclick = () => {
		const origin = target.selected();
		const ipv4 = ipv4Input.value.trim();
		if (!origin) return noTarget(messageEl);
		if (!isIPv4(ipv4)) return setMessage(messageEl, _("Enter a valid IPv4 address."), true);
		runAction(saveIPv4, messageEl, () => callSetDeviceIPv4(origin.instance, origin.nodeId, ipv4), actions, _("Device IPv4 address updated."));
	};
	saveTags.onclick = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		runAction(saveTags, messageEl, () => callSetDeviceTags(origin.instance, origin.nodeId, splitValues(tagsInput.value)), actions, _("Device tags updated."));
	};
	saveAuthorized.onclick = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		runAction(saveAuthorized, messageEl, () => callSetDeviceAuthorized(origin.instance, origin.nodeId, authorizedInput.checked), actions, _("Device authorization updated."));
	};
	saveKey.onclick = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		runAction(saveKey, messageEl, () => callSetDeviceKey(origin.instance, origin.nodeId, keyExpiryInput.checked), actions, _("Device key setting updated."));
	};
	const routesButton = <button class="cbi-button cbi-button-action" type="button">{_("Subnet Routes")}</button> as HTMLButtonElement;
	routesButton.onclick = () => showRoutesEditor(device, actions);
	const attributesButton = <button class="cbi-button cbi-button-action" type="button">{_("Posture Attributes")}</button> as HTMLButtonElement;
	attributesButton.onclick = () => showAttributesEditor(device, actions);
	const expireButton = <button class="cbi-button cbi-button-negative" type="button">{_("Expire Key")}</button> as HTMLButtonElement;
	expireButton.onclick = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		runDangerousAction(_("Expire Device Key"), _("This immediately expires the device key. The device must reauthenticate to reconnect."), () => callExpireDevice(origin.instance, origin.nodeId), actions, _("Device key expired."));
	};
	const deleteButton = <button class="cbi-button cbi-button-negative" type="button">{_("Delete Device")}</button> as HTMLButtonElement;
	deleteButton.onclick = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		runDangerousAction(_("Delete Device"), _("This permanently removes the device from this tailnet."), () => callDeleteDevice(origin.instance, origin.nodeId), actions, _("Device deleted."));
	};

	ui.showModal(
		_("Edit Device"),
		<div>
			{target.element}
			{detailField(_("Name"), <>{nameInput} {saveName}</>)}
			{detailField(_("IPv4 Address"), <>{ipv4Input} {saveIPv4}</>)}
			{detailField(_("Tags"), <>{tagsInput} {saveTags}</>)}
			{detailField(_("Authorized"), <>{authorizedInput} {saveAuthorized}</>)}
			{detailField(_("Disable Key Expiry"), <>{keyExpiryInput} {saveKey}</>)}
			{detailField(_("Advanced"), <>{routesButton} {attributesButton}</>)}
			{detailField(_("Danger Zone"), <>{expireButton} {deleteButton}</>)}
			{messageEl}
			<div style="margin-top: 0.75em; text-align: right;">
				<button class="cbi-button cbi-button-neutral" type="button" onclick={ui.hideModal}>{_("Close")}</button>
			</div>
		</div>,
	);
}

export function showRoutesEditor(device: Device, actions: DeviceDialogActions): void {
	const target = targetSelector(device);
	const advertisedEl = <div>-</div>;
	const routesInput = <textarea class="cbi-input-text" rows={6} style="width: 100%; box-sizing: border-box;"></textarea> as HTMLTextAreaElement;
	const messageEl = <div style="min-height: 1.2em; margin-top: 0.75em;"></div>;
	const saveButton = <button class="cbi-button cbi-button-save" type="button">{_("Save Routes")}</button> as HTMLButtonElement;
	const load = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		messageEl.textContent = _("Loading routes...");
		callDeviceRoutes(origin.instance, origin.nodeId)
			.then((result) => {
				if (result?.error) throw new Error(result.error);
				routesInput.value = (result.enabledRoutes || []).join("\n");
				advertisedEl.textContent = (result.advertisedRoutes || []).join(", ") || "-";
				messageEl.textContent = "";
			})
			.catch((error: unknown) => setMessage(messageEl, actionError(error, _("Unable to load routes.")), true));
	};
	if (target.select) target.select.onchange = load;
	saveButton.onclick = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		runAction(saveButton, messageEl, () => callSetDeviceRoutes(origin.instance, origin.nodeId, splitValues(routesInput.value)), actions, _("Device routes updated."));
	};
	ui.showModal(
		_("Subnet Routes"),
		<div>
			{target.element}
			{detailField(_("Advertised Routes"), advertisedEl)}
			{detailField(_("Enabled Routes"), routesInput)}
			<p>{_("Enter one CIDR route per line. Saving replaces the enabled route list.")}</p>
			{messageEl}
			<div style="margin-top: 0.75em; text-align: right;">
				<button class="cbi-button cbi-button-neutral" type="button" onclick={ui.hideModal}>{_("Close")}</button>{" "}
				{saveButton}
			</div>
		</div>,
	);
	load();
}

export function showAttributesEditor(device: Device, actions: DeviceDialogActions): void {
	const target = targetSelector(device);
	const tableBody = <tbody></tbody>;
	const keyInput = <input class="cbi-input-text" type="text" placeholder="com.example.attribute" /> as HTMLInputElement;
	const valueInput = <textarea class="cbi-input-text" rows={3} placeholder='{"value": true}'></textarea> as HTMLTextAreaElement;
	const expiryInput = <input class="cbi-input-text" type="text" value={new Date(Date.now() + 30 * 86400000).toISOString()} /> as HTMLInputElement;
	const commentInput = <input class="cbi-input-text" type="text" /> as HTMLInputElement;
	const messageEl = <div style="min-height: 1.2em; margin-top: 0.75em;"></div>;
	const saveButton = <button class="cbi-button cbi-button-save" type="button">{_("Set Attribute")}</button> as HTMLButtonElement;
	const render = (attributes: Record<string, unknown>, expiries: Record<string, string>) => {
		const entries = Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right));
		if (entries.length === 0) {
			tableBody.replaceChildren(<tr class="tr"><td class="td" colSpan={4}>{_("No posture attributes configured.")}</td></tr>);
			return;
		}
		tableBody.replaceChildren(...entries.map(([key, value]) => {
			const deleteButton = <button class="cbi-button cbi-button-negative" type="button">{_("Delete")}</button> as HTMLButtonElement;
			deleteButton.onclick = () => {
				const origin = target.selected();
				if (!origin) return noTarget(messageEl);
				runAction(deleteButton, messageEl, () => callDeleteDeviceAttribute(origin.instance, origin.nodeId, key), actions, _("Posture attribute deleted."), load);
			};
			return <tr class="tr"><td class="td"><code>{key}</code></td><td class="td"><code style="word-break: break-all;">{JSON.stringify(value)}</code></td><td class="td">{formatTime(expiries[key])}</td><td class="td">{deleteButton}</td></tr>;
		}));
	};
	const load = () => {
		const origin = target.selected();
		if (!origin) return noTarget(messageEl);
		messageEl.textContent = _("Loading posture attributes...");
		callDeviceAttributes(origin.instance, origin.nodeId)
			.then((result) => {
				if (result?.error) throw new Error(result.error);
				render(result.attributes || {}, result.expiries || {});
				messageEl.textContent = "";
			})
			.catch((error: unknown) => setMessage(messageEl, actionError(error, _("Unable to load posture attributes.")), true));
	};
	if (target.select) target.select.onchange = load;
	saveButton.onclick = () => {
		const origin = target.selected();
		const key = keyInput.value.trim();
		const value = valueInput.value.trim();
		const expiry = expiryInput.value.trim();
		if (!origin) return noTarget(messageEl);
		if (!key || !value || !expiry) return setMessage(messageEl, _("Attribute key, JSON value, and expiry are required."), true);
		try {
			JSON.parse(value);
		} catch {
			return setMessage(messageEl, _("Attribute value must be valid JSON."), true);
		}
		runAction(saveButton, messageEl, () => callSetDeviceAttribute(origin.instance, origin.nodeId, key, value, expiry, commentInput.value.trim()), actions, _("Posture attribute updated."), load);
	};
	ui.showModal(
		_("Posture Attributes"),
		<div>
			{target.element}
			<div style="overflow-x: auto;"><table class="table"><thead><tr class="tr"><th class="th">{_("Key")}</th><th class="th">{_("Value")}</th><th class="th">{_("Expiry")}</th><th class="th">{_("Actions")}</th></tr></thead>{tableBody}</table></div>
			<h4>{_("Set Attribute")}</h4>
			{detailField(_("Key"), keyInput)}
			{detailField(_("Value (JSON)"), valueInput)}
			{detailField(_("Expiry (RFC3339)"), expiryInput)}
			{detailField(_("Comment"), commentInput)}
			{messageEl}
			<div style="margin-top: 0.75em; text-align: right;"><button class="cbi-button cbi-button-neutral" type="button" onclick={ui.hideModal}>{_("Close")}</button>{" "}{saveButton}</div>
		</div>,
	);
	load();
}
