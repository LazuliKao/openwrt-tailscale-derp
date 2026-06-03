type PeersResponse = {
	peers?: PeerInfo[];
	count?: number;
};

type PeerInfo = {
	publicKey: string;
	remoteAddr: string;
	connectedAt: string;
};

type StatusResponse = {
	clients?: number;
	accepts?: number;
	bytesRecv?: number;
	bytesSent?: number;
};

const view = L.view;
const rpc = L.rpc;
const poll = L.Poll;

const callPeers = rpc.declare<PeersResponse>({
	object: "luci.tailscale-derp",
	method: "get_peers",
});

const callStatus = rpc.declare<StatusResponse>({
	object: "luci.tailscale-derp",
	method: "get_status",
});

function formatPublicKey(key: string): string {
	if (key.length > 20) {
		return key.substring(0, 16) + "...";
	}
	return key;
}

function formatTime(iso: string): string {
	try {
		const date = new Date(iso);
		return date.toLocaleString();
	} catch {
		return iso;
	}
}

function formatDuration(iso: string): string {
	try {
		const start = new Date(iso).getTime();
		const now = Date.now();
		const diffMs = Math.max(0, now - start);
		const seconds = Math.floor(diffMs / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) {
			return _("%dd %dh %dm").format(days, hours % 24, minutes % 60);
		}
		if (hours > 0) {
			return _("%dh %dm %ds").format(hours, minutes % 60, seconds % 60);
		}
		if (minutes > 0) {
			return _("%dm %ds").format(minutes, seconds % 60);
		}
		return _("%ds").format(seconds);
	} catch {
		return "-";
	}
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

type PeersView = {
	tableBody: HTMLElement;
	countEl: HTMLElement;
	errorEl: HTMLElement;
	lastUpdatedEl: HTMLElement;
	trafficEl: HTMLElement;
};

function buildPeerRows(peers: PeerInfo[]): HTMLElement[] {
	if (peers.length === 0) {
		const row = (
			<tr class="tr">
				<td class="td" colSpan={4} style="text-align: center;">
					{_("No connected peers")}
				</td>
			</tr>
		);
		return [row];
	}
	return peers.map((peer) => (
		<tr class="tr">
			<td class="td" style="font-family: monospace;" title={peer.publicKey}>
				{formatPublicKey(peer.publicKey)}
			</td>
			<td class="td">{peer.remoteAddr}</td>
			<td class="td">{formatDuration(peer.connectedAt)}</td>
			<td class="td">{formatTime(peer.connectedAt)}</td>
		</tr>
	));
}

function pollPeers(view: PeersView): Promise<void> {
	return Promise.all([callPeers(), callStatus()])
		.then(([peersData, statusData]) => {
			const peers = peersData?.peers || [];
			view.countEl.textContent = _("%d connected peer(s)").format(peers.length);
			view.errorEl.textContent = "";
			view.lastUpdatedEl.textContent =
				_("Last updated: %s").format(new Date().toLocaleTimeString());

			const bytesRecv = statusData?.bytesRecv ?? 0;
			const bytesSent = statusData?.bytesSent ?? 0;
			view.trafficEl.textContent =
				"↓ " + formatBytes(bytesRecv) + " / ↑ " + formatBytes(bytesSent);

			while (view.tableBody.firstChild) {
				view.tableBody.removeChild(view.tableBody.firstChild);
			}
			for (const row of buildPeerRows(peers)) {
				view.tableBody.appendChild(row);
			}
		})
		.catch((err: unknown) => {
			const message =
				err instanceof Error ? err.message : "Backend unavailable";
			view.errorEl.textContent = message;
			view.countEl.textContent = "0 " + _("connected peer(s)");
		});
}

export const main = view.extend({
	load() {
		return Promise.all([
			callPeers().catch(() => ({ peers: [], count: 0 })),
			callStatus().catch(() => ({})),
		]);
	},

	render(this: PeersView, data: [PeersResponse, StatusResponse]) {
		const peersData = data[0] || {};
		const statusData = data[1] || {};
		const peers = peersData.peers || [];

		const bytesRecv = statusData.bytesRecv ?? 0;
		const bytesSent = statusData.bytesSent ?? 0;

		const countEl = (
			<div style="margin-bottom: 0.75em; color: #333;">
				{_("%d connected peer(s)").format(peers.length)}
			</div>
		);

		const errorEl = (
			<div style="margin-bottom: 0.5em; color: #c00; min-height: 1.2em;"></div>
		);

		const lastUpdatedEl = (
			<div style="margin-bottom: 0.5em; color: #666; font-size: 0.9em;"></div>
		);

		const trafficEl = (
			<div style="margin-bottom: 0.75em; color: #333;">
				{"↓ " + formatBytes(bytesRecv) + " / ↑ " + formatBytes(bytesSent)}
			</div>
		);

		const tableBody = <tbody></tbody>;

		this.tableBody = tableBody;
		this.countEl = countEl;
		this.errorEl = errorEl;
		this.lastUpdatedEl = lastUpdatedEl;
		this.trafficEl = trafficEl;

		for (const row of buildPeerRows(peers)) {
			tableBody.appendChild(row);
		}

		poll.add(() => pollPeers(this), 5);

		return (
			<div>
				<h2>{_("DERP Connected Peers")}</h2>
				<div class="cbi-section">
					<h3>{_("Connected Peers")}</h3>
					{countEl}
					{trafficEl}
					{lastUpdatedEl}
					{errorEl}
					<table class="table">
						<thead>
							<tr class="tr">
								<th class="th">{_("Public Key")}</th>
								<th class="th">{_("Remote Address")}</th>
								<th class="th">{_("Duration")}</th>
								<th class="th">{_("Connected At")}</th>
							</tr>
						</thead>
						{tableBody}
					</table>
				</div>
			</div>
		);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
});
