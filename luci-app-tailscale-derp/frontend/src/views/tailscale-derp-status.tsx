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
	running?: boolean;
	listen?: string;
	stun?: boolean;
	mesh?: boolean;
	metrics?: string;
	health?: string;
	error?: string;
};

type VersionResponse = {
	version?: string;
};

type NormalizedStatus = {
	running: boolean;
	listen: string;
	stun: string;
	mesh: string;
	metrics: string;
	health: string;
	error: string;
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

function normalizeStatus(data: StatusResponse): NormalizedStatus {
	return {
		running: Boolean(data.running),
		listen: data.listen || "Not configured",
		stun: data.stun ? "Yes" : "No",
		mesh: data.mesh ? "Yes" : "No",
		metrics: data.metrics || "127.0.0.1:9911",
		health: data.health || ":9912",
		error: data.error || "",
	};
}

function setText(id: string, value: string): void {
	const el = document.getElementById(id);
	if (el) {
		el.textContent = value;
	}
}

function setActionResult(kind: "error" | "success", message: string): void {
	const el = document.getElementById("ops-result");
	if (!el) {
		return;
	}

	el.style.color = kind === "error" ? "#c00" : "#090";
	el.textContent = message;
}

function setActionButtonsDisabled(disabled: boolean): void {
	const buttons =
		document.querySelectorAll<HTMLButtonElement>("[data-derp-action]");
	buttons.forEach((button) => {
		button.disabled = disabled;
	});
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

function renderOfflineState(message: string): void {
	setText("derp-status", _("Offline"));
	setText("derp-version", "Unavailable");
	setText("derp-listen", "Unavailable");
	setText("derp-stun", "Unknown");
	setText("derp-mesh", "Unknown");
	setText("derp-metrics", "Unavailable");
	setText("derp-health", "Unavailable");
	setText("derp-error", message || "Status backend unavailable");
	renderSyncState(null, message || "Status backend unavailable");
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

function renderSyncState(
	normalized: NormalizedStatus | null,
	backendMessage: string,
): void {
	const el = document.getElementById("derp-sync");
	const state = getSyncState(normalized, backendMessage);

	if (!el) {
		return;
	}

	if (state.clear) {
		clearPendingStatus();
	}

	el.style.color = state.color;
	el.textContent = state.text;
}

function renderStatus(status: StatusResponse, version: VersionResponse): void {
	const normalized = normalizeStatus(status || {});
	setText("derp-status", normalized.running ? "Running" : "Stopped");
	setText("derp-version", version.version || "Unknown");
	setText("derp-listen", normalized.listen);
	setText("derp-stun", normalized.stun);
	setText("derp-mesh", normalized.mesh);
	setText("derp-metrics", normalized.metrics);
	setText("derp-health", normalized.health);
	setText("derp-error", normalized.error || "None");
	renderSyncState(normalized, normalized.error);
}

function pollStatus(): Promise<void> {
	return Promise.all([callStatus(), callVersion()])
		.then(([status, version]) => {
			renderStatus(status || {}, version || {});
		})
		.catch((err: unknown) => {
			const message =
				err instanceof Error ? err.message : "Status backend unavailable";
			renderOfflineState(message);
		});
}

type StatusView = {
	handleAction: (action: ActionName) => Promise<void>;
};

export const main = view.extend({
	handleAction(this: StatusView, action: ActionName) {
		const label = actionLabel(action);

		if (shouldConfirm(action)) {
			const message = `Are you sure you want to ${action} the DERP service?`;
			if (!window.confirm(message)) {
				setActionResult("error", `${label} cancelled.`);
				return Promise.resolve();
			}
		}

		setActionButtonsDisabled(true);
		setActionResult("success", `${label} in progress...`);

		return invokeAction(action)
			.then((result) => {
				const response = result || {};
				const resultLabel = response.result || "ok";
				const errorMessage = response.error;

				if (resultLabel !== "ok" || errorMessage) {
					throw new Error(errorMessage || `${label} failed`);
				}

				setActionResult("success", `${label} completed successfully.`);
				return pollStatus();
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : "unknown error";
				setActionResult("error", `${label} failed: ${message}`);
				return pollStatus();
			})
			.finally(() => {
				setActionButtonsDisabled(false);
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
		const initialState = normalized.error
			? "Offline"
			: normalized.running
				? "Running"
				: "Stopped";
		const initialVersion = normalized.error
			? "Unavailable"
			: version.version || "Unknown";
		const initialListen = normalized.error ? "Unavailable" : normalized.listen;
		const initialStun = normalized.error ? "Unknown" : normalized.stun;
		const initialMesh = normalized.error ? "Unknown" : normalized.mesh;
		const initialMetrics = normalized.error
			? "Unavailable"
			: normalized.metrics;
		const initialHealth = normalized.error ? "Unavailable" : normalized.health;
		const initialError = normalized.error || "None";
		const initialSyncState = getSyncState(normalized, normalized.error);

		if (initialSyncState.clear) {
			clearPendingStatus();
		}

		const handleStart = ui.createHandlerFn(this, "handleAction", "start");
		const handleStop = ui.createHandlerFn(this, "handleAction", "stop");
		const handleRestart = ui.createHandlerFn(this, "handleAction", "restart");
		const handleReload = ui.createHandlerFn(this, "handleAction", "reload");

		const statusTable = (
			<table class="table">
				<tr class="tr">
					<td class="td">Service Status</td>
					<td class="td" id="derp-status">{initialState}</td>
				</tr>
				<tr class="tr">
					<td class="td">Version</td>
					<td class="td" id="derp-version">{initialVersion}</td>
				</tr>
				<tr class="tr">
					<td class="td">Listen Address</td>
					<td class="td" id="derp-listen">{initialListen}</td>
				</tr>
				<tr class="tr">
					<td class="td">STUN Enabled</td>
					<td class="td" id="derp-stun">{initialStun}</td>
				</tr>
				<tr class="tr">
					<td class="td">Mesh Enabled</td>
					<td class="td" id="derp-mesh">{initialMesh}</td>
				</tr>
				<tr class="tr">
					<td class="td">Metrics Address</td>
					<td class="td" id="derp-metrics">{initialMetrics}</td>
				</tr>
				<tr class="tr">
					<td class="td">Health Address</td>
					<td class="td" id="derp-health">{initialHealth}</td>
				</tr>
				<tr class="tr">
					<td class="td">Last Error</td>
					<td class="td" id="derp-error">{initialError}</td>
				</tr>
			</table>
		);

		const card = (
			<div class="cbi-section">
				<h3>DERP Server Status</h3>
				<div
					id="derp-sync"
					style={`margin-bottom: 0.75em; color: ${initialSyncState.color};`}
				>
					{initialSyncState.text}
				</div>
				{statusTable}
			</div>
		);

		const actions = (
			<div class="cbi-section" style="margin-top: 1em;">
				<h3>Service Actions</h3>
				<div class="cbi-section-node">
					<button
						class="cbi-button cbi-button-action"
						data-derp-action="start"
						onClick={handleStart}
					>
						Start
					</button>
					{" "}
					<button
						class="cbi-button cbi-button-negative"
						data-derp-action="stop"
						onClick={handleStop}
					>
						Stop
					</button>
					{" "}
					<button
						class="cbi-button cbi-button-action"
						data-derp-action="restart"
						onClick={handleRestart}
					>
						Restart
					</button>
					{" "}
					<button
						class="cbi-button cbi-button-action"
						data-derp-action="reload"
						onClick={handleReload}
					>
						Reload Config
					</button>
				</div>
				<div
					id="ops-result"
					style="margin-top: 0.75em; min-height: 1.2em; color: #090;"
				>
					No action executed yet.
				</div>
			</div>
		);

		poll.add(() => pollStatus(), 5);

		return (
			<div>
				<h2>Tailscale DERP Status</h2>
				{card}
				{actions}
			</div>
		);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
});
