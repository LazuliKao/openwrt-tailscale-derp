import {
	clearPendingStatus,
	readPendingStatus,
	type ExpectedStatus,
} from "@/shared/config";
import {
	callExternalStatus,
	externalActionCalls,
	type ExternalStatus,
} from "@/shared/external";

type ActionName = "start" | "stop" | "restart" | "reload";
type ExternalActionName = "reconcile" | "check" | "sync";
const view = L.view;
const rpc = L.rpc;
const ui = L.ui;
const poll = L.Poll;

type ActionResponse = {
	action?: string;
	result?: string;
	error?: string;
};

type StatusResponse = {
  verifyClients?: string[];
  verifyEnabled?: boolean;
  verifyURLsEnabled?: boolean;
  verifyTailscaled?: boolean;
  verifyAPIEnabled?: boolean;
  verifyAPIInstances?: number;
  running?: boolean;
  listen?: string;
  stun?: boolean;
  mesh?: boolean;
  opsSocket?: string;
  health?: string;
  error?: string;
  clients?: number;
  accepts?: number;
  bytesRecv?: number;
  bytesSent?: number;
  bytesRecvTotal?: number;
  bytesSentTotal?: number;
  acceptsTotal?: number;
  trafficPersist?: boolean;
  trafficPath?: string;
  trafficInterval?: number;
};

type VersionResponse = {
  version?: string;
};

type NormalizedStatus = {
  verifyClients: string;
  running: boolean;
  listen: string;
  stun: string;
  mesh: string;
  opsSocket: string;
  health: string;
  error: string;
  clients: number;
  accepts: number;
  bytesRecv: number;
  bytesSent: number;
  bytesRecvTotal: number;
  bytesSentTotal: number;
  acceptsTotal: number;
  trafficPersist: boolean;
};

type SyncState = {
	color: string;
	text: string;
	clear: boolean;
};

const pendingStatusMaxAgeMs = 5 * 60 * 1000;

const actionCalls: Record<ActionName, () => Promise<ActionResponse>> = {
	start: rpc.declare<ActionResponse>({
		object: "luci.tailscale-derp",
		method: "start",
	}),
	stop: rpc.declare<ActionResponse>({
		object: "luci.tailscale-derp",
		method: "stop",
	}),
	restart: rpc.declare<ActionResponse>({
		object: "luci.tailscale-derp",
		method: "restart",
	}),
	reload: rpc.declare<ActionResponse>({
		object: "luci.tailscale-derp",
		method: "reload_config",
	}),
};

const callStatus = rpc.declare<StatusResponse>({
	object: "luci.tailscale-derp",
	method: "get_status",
});

const callVersion = rpc.declare<VersionResponse>({
	object: "luci.tailscale-derp",
	method: "get_version",
});

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function normalizeStatus(data: StatusResponse): NormalizedStatus {
	const methods: string[] = [];
	if (data.verifyURLsEnabled) methods.push(_("URLs"));
	if (data.verifyTailscaled) methods.push(_("tailscaled"));
	if (data.verifyAPIEnabled) methods.push(_("Official API"));
	let verifyClients = !data.verifyEnabled
		? _("Disabled")
		: methods.length
			? methods.join(", ")
			: _("Enabled, but no methods configured");
	if (data.verifyAPIInstances && data.verifyAPIInstances > 0) {
		verifyClients += ` (${data.verifyAPIInstances} ${_("API instance(s)")})`;
	}
	if (data.verifyClients?.length) {
		verifyClients += `; ${data.verifyClients.join(", ")}`;
	}
	return {
		verifyClients,
		running: !!data.running,
		listen: data.listen || _("N/A"),
		stun: data.stun ? _("Yes") : _("No"),
		mesh: data.mesh ? _("Yes") : _("No"),
		opsSocket: data.opsSocket || _("N/A"),
		health: data.health || _("N/A"),
		error: data.error || "",
		clients: data.clients ?? 0,
		accepts: data.accepts ?? 0,
		bytesRecv: data.bytesRecv ?? 0,
		bytesSent: data.bytesSent ?? 0,
		bytesRecvTotal: data.bytesRecvTotal ?? 0,
		bytesSentTotal: data.bytesSentTotal ?? 0,
		acceptsTotal: data.acceptsTotal ?? 0,
		trafficPersist: !!data.trafficPersist,
	};
}

function actionLabel(action: ActionName): string {
	switch (action) {
		case "start":
		return _("Start");
		case "stop":
		return _("Stop");
		case "restart":
		return _("Restart");
		case "reload":
		return _("Reload");
	}
}

function shouldConfirm(action: ActionName): boolean {
	return action === "stop" || action === "restart";
}

function invokeAction(action: ActionName): Promise<ActionResponse> {
	return actionCalls[action]();
}

function externalActionLabel(action: ExternalActionName): string {
	switch (action) {
		case "reconcile":
			return _("Remap Now");
		case "check":
			return _("Check Locally");
		case "sync":
			return _("Sync DERP Map");
	}
}

function formatExternalEndpoint(status: ExternalStatus): string {
	const endpoint = status.endpoint;
	if (!endpoint?.ipv4 || !endpoint.derpPort) {
		return _("Not mapped");
	}
	const stun = endpoint.stunPort === -1
		? _("STUN disabled")
		: `UDP ${endpoint.ipv4}:${endpoint.stunPort || 3478}`;
	return `TCP ${endpoint.ipv4}:${endpoint.derpPort}; ${stun}`;
}

function formatValidation(status: ExternalStatus): string {
	const validation = status.validation || {};
	if (!status.validationEnabled && (!validation.state || validation.state === "disabled")) {
		return `${_("Disabled")} (${_("local NAT loopback only")})`;
	}
	const state = validation.state || _("Unknown");
	const scope = validation.scope || "local_nat_loopback";
	return `${state} (${scope})${validation.error ? `: ${validation.error}` : ""}`;
}

function renderExternalInstances(status: ExternalStatus): HTMLElement[] {
	const instances = status.instances || [];
	if (!instances.length) {
		return [<span>{_("No synchronized instances")}</span>];
	}
	return instances.map((instance) => (
		<div>
			<strong>{instance.label || instance.name || _("Unnamed instance")}</strong>
			{`: ${instance.state || _("Unknown")}${instance.error ? ` - ${instance.error}` : ""}`}
		</div>
	));
}

function updateExternalStatus(view: StatusView, status: ExternalStatus): void {
	view.externalStateEl.textContent = status.state || (status.enabled ? _("Unknown") : _("Disabled"));
	view.externalEndpointEl.textContent = formatExternalEndpoint(status);
	view.externalMethodEl.textContent = status.endpoint?.method || _("N/A");
	view.externalLeaseEl.textContent = status.endpoint?.leaseUntil || _("N/A");
	view.externalValidationEl.textContent = formatValidation(status);
	view.externalFailuresEl.textContent = `${status.failureCount || 0}/${status.failureThreshold || 3}`;
	view.externalErrorEl.textContent = status.error || _("None");
	view.externalInstancesEl.replaceChildren(...renderExternalInstances(status));
}

function normalizeAddress(value: string): string {
	if (!value) {
		return "";
	}

	if (/^:\d+$/.test(value)) {
		return `0.0.0.0${value}`;
	}

	const match = value.match(/^\[::\]:(\d+)$/);
	if (match) {
		return `0.0.0.0:${match[1]}`;
	}

	return value;
}

function isPendingExpired(pending: ExpectedStatus): boolean {
	return (
		!pending.savedAt || Date.now() - pending.savedAt > pendingStatusMaxAgeMs
	);
}

function matchesPendingStatus(
	normalized: NormalizedStatus,
	pending: ExpectedStatus | null,
): boolean {
	if (!pending) {
		return false;
	}

	if (pending.enabled === false) {
		return normalized.error !== "" || normalized.running === false;
	}

	return (
		normalized.running === true &&
		normalizeAddress(normalized.listen) === normalizeAddress(pending.listen) &&
		normalized.stun === (pending.stun ? _("Yes") : _("No")) &&
		normalized.mesh === (pending.mesh ? _("Yes") : _("No")) &&
		normalized.opsSocket === pending.opsSocket &&
		normalized.health === pending.health
	);
}

function getSyncState(
	normalized: NormalizedStatus | null,
	backendMessage: string,
): SyncState {
	const pending = readPendingStatus();

	if (!pending) {
		return {
			color: "inherit",
			text: _("No configuration change pending."),
			clear: false,
		};
	}

	if (isPendingExpired(pending)) {
		return {
			color: "#c60",
			text: _("Saved configuration status expired before it could be confirmed."),
			clear: true,
		};
	}

	if (normalized && matchesPendingStatus(normalized, pending)) {
		return {
			color: "#1a7f37",
			text: _("Saved configuration is now active."),
			clear: true,
		};
	}

	return {
		color: "#c60",
		text: backendMessage
			? `${_("Waiting for saved configuration to become active:")} ${backendMessage}`
			: _("Waiting for saved configuration to become active..."),
		clear: false,
	};
}

type StatusView = {
	statusEl: HTMLElement;
	versionEl: HTMLElement;
	listenEl: HTMLElement;
	stunEl: HTMLElement;
	meshEl: HTMLElement;
	verifyClientsEl: HTMLElement;
	opsSocketEl: HTMLElement;
	healthEl: HTMLElement;
	errorEl: HTMLElement;
	clientsEl: HTMLElement;
	trafficEl: HTMLElement;
	trafficTotalEl: HTMLElement;
	syncEl: HTMLElement;
	resultEl: HTMLElement;
	actionButtons: HTMLButtonElement[];
	externalStateEl: HTMLElement;
	externalEndpointEl: HTMLElement;
	externalMethodEl: HTMLElement;
	externalLeaseEl: HTMLElement;
	externalValidationEl: HTMLElement;
	externalFailuresEl: HTMLElement;
	externalErrorEl: HTMLElement;
	externalInstancesEl: HTMLElement;
	externalButtons: HTMLButtonElement[];
	handleAction: (action: ActionName) => Promise<void>;
	handleExternalAction: (action: ExternalActionName) => Promise<void>;
};

function pollStatus(view: StatusView): Promise<void> {
	return Promise.all([
		callStatus(),
		callVersion(),
		callExternalStatus().catch((err: unknown) => ({
			state: "unavailable",
			error: err instanceof Error ? err.message : _("External endpoint backend unavailable"),
		})),
	])
		.then(([status, version, external]) => {
			const normalized = normalizeStatus(status || {});
				view.statusEl.textContent = normalized.running ? _("Running") : _("Stopped");
				view.versionEl.textContent = normalized.error
					? _("Unavailable")
					: version?.version || _("Unknown");
				view.listenEl.textContent = normalized.error
					? _("Unavailable")
					: normalized.listen;
				view.stunEl.textContent = normalized.error
					? _("Unknown")
					: normalized.stun;
				view.meshEl.textContent = normalized.error
					? _("Unknown")
					: normalized.mesh;
				view.verifyClientsEl.textContent = normalized.error
					? _("Unknown")
					: normalized.verifyClients;
				view.opsSocketEl.textContent = normalized.error
					? _("Unavailable")
					: normalized.opsSocket;
				view.healthEl.textContent = normalized.error
					? _("Unavailable")
					: normalized.health;
				view.errorEl.textContent = normalized.error || _("None");
				view.clientsEl.textContent = `${normalized.clients} ${_("connected")} (${normalized.accepts} ${_("total accepted")})`;
			if (normalized.trafficPersist) {
				view.trafficEl.textContent = `Session: ↓ ${formatBytes(normalized.bytesRecv)} / ↑ ${formatBytes(normalized.bytesSent)}`;
				view.trafficTotalEl.textContent = `Total: ↓ ${formatBytes(normalized.bytesRecvTotal)} / ↑ ${formatBytes(normalized.bytesSentTotal)}`;
				view.trafficTotalEl.style.display = "";
			} else {
				view.trafficEl.textContent = `↓ ${formatBytes(normalized.bytesRecv)} / ↑ ${formatBytes(normalized.bytesSent)}`;
				view.trafficTotalEl.style.display = "none";
			}

			const syncState = getSyncState(normalized, normalized.error);
			if (syncState.clear) {
				clearPendingStatus();
			}
			view.syncEl.style.color = syncState.color;
			view.syncEl.textContent = syncState.text;
			updateExternalStatus(view, external || {});
		})
		.catch((err: unknown) => {
				const message =
					err instanceof Error ? err.message : _("Status backend unavailable");
				view.statusEl.textContent = _("Offline");
				view.versionEl.textContent = _("Unavailable");
				view.listenEl.textContent = _("Unavailable");
				view.stunEl.textContent = _("Unknown");
				view.meshEl.textContent = _("Unknown");
				view.verifyClientsEl.textContent = _("Unknown");
				view.opsSocketEl.textContent = _("Unavailable");
				view.healthEl.textContent = _("Unavailable");
				view.errorEl.textContent = message || _("Status backend unavailable");
				view.clientsEl.textContent = `0 ${_("connected")} (0 ${_("total accepted")})`;
				view.trafficEl.textContent = "↓ 0 B / ↑ 0 B";
				view.trafficTotalEl.textContent = "";
				view.trafficTotalEl.style.display = "none";

				const syncState = getSyncState(null, message || _("Status backend unavailable"));
			if (syncState.clear) {
				clearPendingStatus();
			}
			view.syncEl.style.color = syncState.color;
			view.syncEl.textContent = syncState.text;
			updateExternalStatus(view, { state: "unavailable", error: message });
		});
}

export const main = (view as any).extend({
	handleAction(this: StatusView, action: ActionName) {
		const label = actionLabel(action);

		if (shouldConfirm(action)) {
			const message = `${_("Are you sure you want to")} ${action} ${_("the DERP service?")}`;
			if (!window.confirm(message)) {
				this.resultEl.style.color = "#cf222e";
				this.resultEl.textContent = `${label} ${_("cancelled.")}`;
				return Promise.resolve();
			}
		}

		for (const btn of this.actionButtons) {
			btn.disabled = true;
		}
		this.resultEl.style.color = "#1a7f37";
		this.resultEl.textContent = `${label} ${_("in progress...")}`;

		return invokeAction(action)
			.then((result) => {
				const response = result || {};
				const resultLabel = response.result || "ok";
				const errorMessage = response.error;

				if (resultLabel !== "ok" || errorMessage) {
						throw new Error(errorMessage || `${label} ${_("failed")}`);
				}

				this.resultEl.style.color = "#1a7f37";
				this.resultEl.textContent = `${label} ${_("completed successfully.")}`;
				return pollStatus(this);
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : _("unknown error");
				this.resultEl.style.color = "#cf222e";
				this.resultEl.textContent = `${label} ${_("failed:")} ${message}`;
				return pollStatus(this);
			})
			.finally(() => {
				for (const btn of this.actionButtons) {
					btn.disabled = false;
				}
			});
	},

	handleExternalAction(this: StatusView, action: ExternalActionName) {
		const label = externalActionLabel(action);
		for (const btn of this.externalButtons) {
			btn.disabled = true;
		}
		this.resultEl.style.color = "#1a7f37";
		this.resultEl.textContent = `${label} ${_("in progress...")}`;

		return externalActionCalls[action]()
			.then((response) => {
				if (response?.result !== "ok" || response.error) {
					throw new Error(response?.error || `${label} ${_("failed")}`);
				}
				this.resultEl.style.color = "#1a7f37";
				this.resultEl.textContent = `${label} ${_("completed successfully.")}`;
				return pollStatus(this);
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : _("unknown error");
				this.resultEl.style.color = "#cf222e";
				this.resultEl.textContent = `${label} ${_("failed:")} ${message}`;
				return pollStatus(this);
			})
			.finally(() => {
				for (const btn of this.externalButtons) {
					btn.disabled = false;
				}
			});
	},

	load() {
		return Promise.all([
			callStatus().catch((err: unknown) => ({
				error:
					err instanceof Error ? err.message : _("Status backend unavailable"),
			})),
			callVersion().catch(() => ({ version: _("Unavailable") })),
			callExternalStatus().catch((err: unknown) => ({
				state: "unavailable",
				error: err instanceof Error ? err.message : _("External endpoint backend unavailable"),
			})),
		]);
	},

	render(this: StatusView, data: [StatusResponse, VersionResponse, ExternalStatus]) {
		const status = data[0] || {};
		const version = data[1] || {};
		const normalized = normalizeStatus(status);
		const external = data[2] || {};
		const initialSyncState = getSyncState(normalized, normalized.error);

		if (initialSyncState.clear) {
			clearPendingStatus();
		}

		const handleStart = ui.createHandlerFn(this, "handleAction", "start");
		const handleStop = ui.createHandlerFn(this, "handleAction", "stop");
		const handleRestart = ui.createHandlerFn(this, "handleAction", "restart");
		const handleReload = ui.createHandlerFn(this, "handleAction", "reload");
		const handleReconcile = ui.createHandlerFn(this, "handleExternalAction", "reconcile");
		const handleCheck = ui.createHandlerFn(this, "handleExternalAction", "check");
		const handleSync = ui.createHandlerFn(this, "handleExternalAction", "sync");

		const statusEl = <td class="td">{normalized.running ? _("Running") : _("Stopped")}</td>;
		const versionEl = <td class="td">{normalized.error ? _("Unavailable") : version.version || _("Unknown")}</td>;
		const listenEl = <td class="td">{normalized.error ? _("Unavailable") : normalized.listen}</td>;
		const stunEl = <td class="td">{normalized.error ? _("Unknown") : normalized.stun}</td>;
		const meshEl = <td class="td">{normalized.error ? _("Unknown") : normalized.mesh}</td>;
		const verifyClientsEl = <td class="td">{normalized.error ? _("Unknown") : normalized.verifyClients}</td>;
		const opsSocketEl = <td class="td">{normalized.error ? _("Unavailable") : normalized.opsSocket}</td>;
		const healthEl = <td class="td">{normalized.error ? _("Unavailable") : normalized.health}</td>;
		const errorEl = <td class="td">{normalized.error || _("None")}</td>;
		const clientsEl = <td class="td">{`${normalized.clients} ${_("connected")} (${normalized.accepts} ${_("total accepted")})`}</td>;
		const trafficEl = <td class="td">{`↓ ${formatBytes(normalized.bytesRecv)} / ↑ ${formatBytes(normalized.bytesSent)}`}</td>;
		const trafficTotalEl = <td class="td" style="display: none;"></td>;
		const externalStateEl = <td class="td">{external.state || (external.enabled ? _("Unknown") : _("Disabled"))}</td>;
		const externalEndpointEl = <td class="td">{formatExternalEndpoint(external)}</td>;
		const externalMethodEl = <td class="td">{external.endpoint?.method || _("N/A")}</td>;
		const externalLeaseEl = <td class="td">{external.endpoint?.leaseUntil || _("N/A")}</td>;
		const externalValidationEl = <td class="td">{formatValidation(external)}</td>;
		const externalFailuresEl = <td class="td">{`${external.failureCount || 0}/${external.failureThreshold || 3}`}</td>;
		const externalErrorEl = <td class="td">{external.error || _("None")}</td>;
		const externalInstancesEl = <td class="td">{renderExternalInstances(external)}</td>;

		if (normalized.trafficPersist) {
			trafficEl.textContent = `Session: ↓ ${formatBytes(normalized.bytesRecv)} / ↑ ${formatBytes(normalized.bytesSent)}`;
			trafficTotalEl.textContent = `Total: ↓ ${formatBytes(normalized.bytesRecvTotal)} / ↑ ${formatBytes(normalized.bytesSentTotal)}`;
			trafficTotalEl.style.display = "";
		}

		const syncEl = (
			<div style={`margin-bottom: 0.75em; color: ${initialSyncState.color};`}>
				{initialSyncState.text}
			</div>
		);

		const resultEl = (
			<div style="margin-top: 0.75em; min-height: 1.2em; color: #1a7f37;">
				{_("No action executed yet.")}
			</div>
		);

		this.statusEl = statusEl;
		this.versionEl = versionEl;
		this.listenEl = listenEl;
		this.stunEl = stunEl;
		this.meshEl = meshEl;
		this.verifyClientsEl = verifyClientsEl;
		this.opsSocketEl = opsSocketEl;
		this.healthEl = healthEl;
		this.errorEl = errorEl;
		this.clientsEl = clientsEl;
		this.trafficEl = trafficEl;
		this.trafficTotalEl = trafficTotalEl;
		this.syncEl = syncEl;
		this.resultEl = resultEl;
		this.externalStateEl = externalStateEl;
		this.externalEndpointEl = externalEndpointEl;
		this.externalMethodEl = externalMethodEl;
		this.externalLeaseEl = externalLeaseEl;
		this.externalValidationEl = externalValidationEl;
		this.externalFailuresEl = externalFailuresEl;
		this.externalErrorEl = externalErrorEl;
		this.externalInstancesEl = externalInstancesEl;

		const btnStart = (
			<button
				class="cbi-button cbi-button-action"
				onclick={handleStart}
			>
				{_("Start")}
			</button>
		);
		const btnStop = (
			<button
				class="cbi-button cbi-button-negative"
				onclick={handleStop}
			>
				{_("Stop")}
			</button>
		);
		const btnRestart = (
			<button
				class="cbi-button cbi-button-action"
				onclick={handleRestart}
			>
				{_("Restart")}
			</button>
		);
		const btnReload = (
			<button
				class="cbi-button cbi-button-action"
				onclick={handleReload}
			>
				{_("Reload Config")}
			</button>
		);
		const btnReconcile = <button class="cbi-button cbi-button-action" onclick={handleReconcile}>{_("Remap Now")}</button>;
		const btnCheck = <button class="cbi-button cbi-button-action" onclick={handleCheck}>{_("Check Locally")}</button>;
		const btnSync = <button class="cbi-button cbi-button-action" onclick={handleSync}>{_("Sync DERP Map")}</button>;

		this.actionButtons = [btnStart, btnStop, btnRestart, btnReload] as HTMLButtonElement[];
		this.externalButtons = [btnReconcile, btnCheck, btnSync] as HTMLButtonElement[];

		poll.add(() => pollStatus(this), 5);

		return (
			<div>
				<h2>{_("Tailscale DERP Status")}</h2>
				<div class="cbi-section">
					<h3>{_("DERP Server Status")}</h3>
					{syncEl}
					<table class="table">
						<tr class="tr">
							<td class="td">{_("Service Status")}</td>
							{statusEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Version")}</td>
							{versionEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Connected Clients")}</td>
							{clientsEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Traffic")}</td>
							{trafficEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Traffic (Total)")}</td>
							{trafficTotalEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Listen Address")}</td>
							{listenEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("STUN Enabled")}</td>
							{stunEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Mesh Enabled")}</td>
							{meshEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Verify Clients")}</td>
							{verifyClientsEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Ops Unix Socket")}</td>
							{opsSocketEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Health Address")}</td>
							{healthEl}
						</tr>
						<tr class="tr">
							<td class="td">{_("Last Error")}</td>
							{errorEl}
						</tr>
					</table>
				</div>
				<div class="cbi-section" style="margin-top: 1em;">
					<h3>{_("External Endpoint (Experimental)")}</h3>
					<p>{_("The optional availability check runs from this router through NAT loopback. A pass does not prove Internet reachability, and a failure may only mean that the gateway does not support hairpin NAT.")}</p>
					<table class="table">
						<tr class="tr"><td class="td">{_("State")}</td>{externalStateEl}</tr>
						<tr class="tr"><td class="td">{_("Mapped Endpoint")}</td>{externalEndpointEl}</tr>
						<tr class="tr"><td class="td">{_("Mapping Method")}</td>{externalMethodEl}</tr>
						<tr class="tr"><td class="td">{_("Lease Until")}</td>{externalLeaseEl}</tr>
						<tr class="tr"><td class="td">{_("Local NAT-loopback Check")}</td>{externalValidationEl}</tr>
						<tr class="tr"><td class="td">{_("Consecutive Failures")}</td>{externalFailuresEl}</tr>
						<tr class="tr"><td class="td">{_("Tailnet Instances")}</td>{externalInstancesEl}</tr>
						<tr class="tr"><td class="td">{_("External Error")}</td>{externalErrorEl}</tr>
					</table>
					<div class="cbi-section-node" style="margin-top: 0.75em;">
						{btnReconcile} {" "} {btnCheck} {" "} {btnSync}
					</div>
				</div>
				<div class="cbi-section" style="margin-top: 1em;">
					<h3>{_("Service Actions")}</h3>
					<div class="cbi-section-node">
						{btnStart}
						{" "}
						{btnStop}
						{" "}
						{btnRestart}
						{" "}
						{btnReload}
					</div>
					{resultEl}
				</div>
			</div>
		);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
});
