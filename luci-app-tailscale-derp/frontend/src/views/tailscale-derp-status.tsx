import {
	clearPendingStatus,
	readPendingStatus,
	type ExpectedStatus,
} from "src/shared/config";

type ActionName = "start" | "stop" | "restart" | "reload";
const view = L.view;
const rpc = L.rpc;
const ui = LuCI.ui;
const poll = L.Poll;

type ActionResponse = {
	action?: string;
	result?: string;
	error?: string;
};

type StatusResponse = {
	verifyClients?: string[];
	running?: boolean;
	listen?: string;
	stun?: boolean;
	mesh?: boolean;
	metrics?: string;
	health?: string;
	error?: string;
	clients?: number;
	accepts?: number;
	bytesRecv?: number;
	bytesSent?: number;
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
	metrics: string;
	health: string;
	error: string;
	clients: number;
	accepts: number;
	bytesRecv: number;
	bytesSent: number;
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
	return {
		verifyClients: data.verifyClients?.length
			? data.verifyClients.join(", ")
			: "Disabled",
		running: !!data.running,
		listen: data.listen || "N/A",
		stun: data.stun ? "Yes" : "No",
		mesh: data.mesh ? "Yes" : "No",
		metrics: data.metrics || "N/A",
		health: data.health || "N/A",
		error: data.error || "",
		clients: data.clients ?? 0,
		accepts: data.accepts ?? 0,
		bytesRecv: data.bytesRecv ?? 0,
		bytesSent: data.bytesSent ?? 0,
	};
}

function actionLabel(action: ActionName): string {
	switch (action) {
		case "start":
			return "Start";
		case "stop":
			return "Stop";
		case "restart":
			return "Restart";
		case "reload":
			return "Reload";
	}
}

function shouldConfirm(action: ActionName): boolean {
	return action === "stop" || action === "restart";
}

function invokeAction(action: ActionName): Promise<ActionResponse> {
	return actionCalls[action]();
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
		normalized.stun === (pending.stun ? "Yes" : "No") &&
		normalized.mesh === (pending.mesh ? "Yes" : "No") &&
		normalized.metrics === pending.metrics &&
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
			color: "#666",
			text: "No configuration change pending.",
			clear: false,
		};
	}

	if (isPendingExpired(pending)) {
		return {
			color: "#c60",
			text: "Saved configuration status expired before it could be confirmed.",
			clear: true,
		};
	}

	if (normalized && matchesPendingStatus(normalized, pending)) {
		return {
			color: "#090",
			text: "Saved configuration is now active.",
			clear: true,
		};
	}

	return {
		color: "#c60",
		text: backendMessage
			? `Waiting for saved configuration to become active: ${backendMessage}`
			: "Waiting for saved configuration to become active...",
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
	metricsEl: HTMLElement;
	healthEl: HTMLElement;
	errorEl: HTMLElement;
	clientsEl: HTMLElement;
	trafficEl: HTMLElement;
	syncEl: HTMLElement;
	resultEl: HTMLElement;
	actionButtons: HTMLButtonElement[];
	handleAction: (action: ActionName) => Promise<void>;
};

function pollStatus(view: StatusView): Promise<void> {
	return Promise.all([callStatus(), callVersion()])
		.then(([status, version]) => {
			const normalized = normalizeStatus(status || {});
			view.statusEl.textContent = normalized.running ? "Running" : "Stopped";
			view.versionEl.textContent = normalized.error
				? "Unavailable"
				: version?.version || "Unknown";
			view.listenEl.textContent = normalized.error
				? "Unavailable"
				: normalized.listen;
			view.stunEl.textContent = normalized.error
				? "Unknown"
				: normalized.stun;
			view.meshEl.textContent = normalized.error
				? "Unknown"
				: normalized.mesh;
			view.verifyClientsEl.textContent = normalized.error
				? "Unknown"
				: normalized.verifyClients;
			view.metricsEl.textContent = normalized.error
				? "Unavailable"
				: normalized.metrics;
			view.healthEl.textContent = normalized.error
				? "Unavailable"
				: normalized.health;
			view.errorEl.textContent = normalized.error || "None";
			view.clientsEl.textContent = `${normalized.clients} connected (${normalized.accepts} total accepted)`;
			view.trafficEl.textContent = `↓ ${formatBytes(normalized.bytesRecv)} / ↑ ${formatBytes(normalized.bytesSent)}`;

			const syncState = getSyncState(normalized, normalized.error);
			if (syncState.clear) {
				clearPendingStatus();
			}
			view.syncEl.style.color = syncState.color;
			view.syncEl.textContent = syncState.text;
		})
		.catch((err: unknown) => {
			const message =
				err instanceof Error ? err.message : "Status backend unavailable";
			view.statusEl.textContent = _("Offline");
			view.versionEl.textContent = "Unavailable";
			view.listenEl.textContent = "Unavailable";
			view.stunEl.textContent = "Unknown";
			view.meshEl.textContent = "Unknown";
			view.verifyClientsEl.textContent = "Unknown";
			view.metricsEl.textContent = "Unavailable";
			view.healthEl.textContent = "Unavailable";
			view.errorEl.textContent = message || "Status backend unavailable";
			view.clientsEl.textContent = "0 connected (0 total accepted)";
			view.trafficEl.textContent = "↓ 0 B / ↑ 0 B";

			const syncState = getSyncState(null, message || "Status backend unavailable");
			if (syncState.clear) {
				clearPendingStatus();
			}
			view.syncEl.style.color = syncState.color;
			view.syncEl.textContent = syncState.text;
		});
}

export const main = view.extend({
	handleAction(this: StatusView, action: ActionName) {
		const label = actionLabel(action);

		if (shouldConfirm(action)) {
			const message = `Are you sure you want to ${action} the DERP service?`;
			if (!window.confirm(message)) {
				this.resultEl.style.color = "#c00";
				this.resultEl.textContent = `${label} cancelled.`;
				return Promise.resolve();
			}
		}

		for (const btn of this.actionButtons) {
			btn.disabled = true;
		}
		this.resultEl.style.color = "#090";
		this.resultEl.textContent = `${label} in progress...`;

		return invokeAction(action)
			.then((result) => {
				const response = result || {};
				const resultLabel = response.result || "ok";
				const errorMessage = response.error;

				if (resultLabel !== "ok" || errorMessage) {
					throw new Error(errorMessage || `${label} failed`);
				}

				this.resultEl.style.color = "#090";
				this.resultEl.textContent = `${label} completed successfully.`;
				return pollStatus(this);
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : "unknown error";
				this.resultEl.style.color = "#c00";
				this.resultEl.textContent = `${label} failed: ${message}`;
				return pollStatus(this);
			})
			.finally(() => {
				for (const btn of this.actionButtons) {
					btn.disabled = false;
				}
			});
	},

	load() {
		return Promise.all([
			callStatus().catch((err: unknown) => ({
				error:
					err instanceof Error ? err.message : "Status backend unavailable",
			})),
			callVersion().catch(() => ({ version: "Unavailable" })),
		]);
	},

	render(this: StatusView, data: [StatusResponse, VersionResponse]) {
		const status = data[0] || {};
		const version = data[1] || {};
		const normalized = normalizeStatus(status);
		const initialSyncState = getSyncState(normalized, normalized.error);

		if (initialSyncState.clear) {
			clearPendingStatus();
		}

		const handleStart = ui.createHandlerFn(this, "handleAction", "start");
		const handleStop = ui.createHandlerFn(this, "handleAction", "stop");
		const handleRestart = ui.createHandlerFn(this, "handleAction", "restart");
		const handleReload = ui.createHandlerFn(this, "handleAction", "reload");

		const statusEl = <td class="td">{normalized.running ? "Running" : "Stopped"}</td>;
		const versionEl = <td class="td">{normalized.error ? "Unavailable" : version.version || "Unknown"}</td>;
		const listenEl = <td class="td">{normalized.error ? "Unavailable" : normalized.listen}</td>;
		const stunEl = <td class="td">{normalized.error ? "Unknown" : normalized.stun}</td>;
		const meshEl = <td class="td">{normalized.error ? "Unknown" : normalized.mesh}</td>;
		const verifyClientsEl = <td class="td">{normalized.error ? "Unknown" : normalized.verifyClients}</td>;
		const metricsEl = <td class="td">{normalized.error ? "Unavailable" : normalized.metrics}</td>;
		const healthEl = <td class="td">{normalized.error ? "Unavailable" : normalized.health}</td>;
		const errorEl = <td class="td">{normalized.error || "None"}</td>;
		const clientsEl = <td class="td">{`${normalized.clients} connected (${normalized.accepts} total accepted)`}</td>;
		const trafficEl = <td class="td">{`↓ ${formatBytes(normalized.bytesRecv)} / ↑ ${formatBytes(normalized.bytesSent)}`}</td>;

		const syncEl = (
			<div style={`margin-bottom: 0.75em; color: ${initialSyncState.color};`}>
				{initialSyncState.text}
			</div>
		);

		const resultEl = (
			<div style="margin-top: 0.75em; min-height: 1.2em; color: #090;">
				No action executed yet.
			</div>
		);

		this.statusEl = statusEl;
		this.versionEl = versionEl;
		this.listenEl = listenEl;
		this.stunEl = stunEl;
		this.meshEl = meshEl;
		this.verifyClientsEl = verifyClientsEl;
		this.metricsEl = metricsEl;
		this.healthEl = healthEl;
		this.errorEl = errorEl;
		this.clientsEl = clientsEl;
		this.trafficEl = trafficEl;
		this.syncEl = syncEl;
		this.resultEl = resultEl;

		const btnStart = (
			<button
				class="cbi-button cbi-button-action"
				onClick={handleStart}
			>
				Start
			</button>
		);
		const btnStop = (
			<button
				class="cbi-button cbi-button-negative"
				onClick={handleStop}
			>
				Stop
			</button>
		);
		const btnRestart = (
			<button
				class="cbi-button cbi-button-action"
				onClick={handleRestart}
			>
				Restart
			</button>
		);
		const btnReload = (
			<button
				class="cbi-button cbi-button-action"
				onClick={handleReload}
			>
				Reload Config
			</button>
		);

		this.actionButtons = [btnStart, btnStop, btnRestart, btnReload];

		poll.add(() => pollStatus(this), 5);

		return (
			<div>
				<h2>Tailscale DERP Status</h2>
				<div class="cbi-section">
					<h3>DERP Server Status</h3>
					{syncEl}
					<table class="table">
						<tr class="tr">
							<td class="td">Service Status</td>
							{statusEl}
						</tr>
						<tr class="tr">
							<td class="td">Version</td>
							{versionEl}
						</tr>
						<tr class="tr">
							<td class="td">Connected Clients</td>
							{clientsEl}
						</tr>
						<tr class="tr">
							<td class="td">Traffic</td>
							{trafficEl}
						</tr>
						<tr class="tr">
							<td class="td">Listen Address</td>
							{listenEl}
						</tr>
						<tr class="tr">
							<td class="td">STUN Enabled</td>
							{stunEl}
						</tr>
						<tr class="tr">
							<td class="td">Mesh Enabled</td>
							{meshEl}
						</tr>
						<tr class="tr">
							<td class="td">Verify Clients</td>
							{verifyClientsEl}
						</tr>
						<tr class="tr">
							<td class="td">Metrics Address</td>
							{metricsEl}
						</tr>
						<tr class="tr">
							<td class="td">Health Address</td>
							{healthEl}
						</tr>
						<tr class="tr">
							<td class="td">Last Error</td>
							{errorEl}
						</tr>
					</table>
				</div>
				<div class="cbi-section" style="margin-top: 1em;">
					<h3>Service Actions</h3>
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
