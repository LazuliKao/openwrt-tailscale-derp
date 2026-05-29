type PeersResponse = {
	peers?: PeerInfo[];
	count?: number;
};

type PeerInfo = {
	publicKey: string;
	remoteAddr: string;
	connectedAt: string;
};

const view = L.view;
const rpc = L.rpc;
const poll = L.Poll;

const callPeers = rpc.declare<PeersResponse>({
	object: "luci.tailscale-derp",
	method: "get_peers",
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

type PeersView = {
	tableBody: HTMLElement;
	countEl: HTMLElement;
	errorEl: HTMLElement;
};

function pollPeers(view: PeersView): Promise<void> {
	return callPeers()
		.then((data) => {
			const peers = data?.peers || [];
			view.countEl.textContent = `${peers.length} connected peer(s)`;
			view.errorEl.textContent = "";

			while (view.tableBody.firstChild) {
				view.tableBody.removeChild(view.tableBody.firstChild);
			}

			if (peers.length === 0) {
				const row = (
					<tr class="tr">
						<td class="td" colSpan={3} style="text-align: center;">
							No connected peers
						</td>
					</tr>
				);
				view.tableBody.appendChild(row);
				return;
			}

			for (const peer of peers) {
				const row = (
					<tr class="tr">
						<td class="td" style="font-family: monospace;">
							{formatPublicKey(peer.publicKey)}
						</td>
						<td class="td">{peer.remoteAddr}</td>
						<td class="td">{formatTime(peer.connectedAt)}</td>
					</tr>
				);
				view.tableBody.appendChild(row);
			}
		})
		.catch((err: unknown) => {
			const message =
				err instanceof Error ? err.message : "Backend unavailable";
			view.errorEl.textContent = message;
			view.countEl.textContent = "0 connected peer(s)";
		});
}

export const main = view.extend({
	load() {
		return Promise.all([
			callPeers().catch(() => ({ peers: [], count: 0 })),
		]);
	},

	render(this: PeersView, data: [PeersResponse]) {
		const peersData = data[0] || {};
		const peers = peersData.peers || [];

		const countEl = (
			<div style="margin-bottom: 0.75em; color: #333;">
				{peers.length} connected peer(s)
			</div>
		);

		const errorEl = (
			<div style="margin-bottom: 0.5em; color: #c00; min-height: 1.2em;"></div>
		);

		const tableBody = <tbody></tbody>;

		this.tableBody = tableBody;
		this.countEl = countEl;
		this.errorEl = errorEl;

		if (peers.length === 0) {
			const row = (
				<tr class="tr">
					<td class="td" colSpan={3} style="text-align: center;">
						No connected peers
					</td>
				</tr>
			);
			tableBody.appendChild(row);
		} else {
			for (const peer of peers) {
				const row = (
					<tr class="tr">
						<td class="td" style="font-family: monospace;">
							{formatPublicKey(peer.publicKey)}
						</td>
						<td class="td">{peer.remoteAddr}</td>
						<td class="td">{formatTime(peer.connectedAt)}</td>
					</tr>
				);
				tableBody.appendChild(row);
			}
		}

		poll.add(() => pollPeers(this), 5);

		return (
			<div>
				<h2>DERP Connected Peers</h2>
				<div class="cbi-section">
					<h3>Connected Peers</h3>
					{countEl}
					{errorEl}
					<table class="table">
						<thead>
							<tr class="tr">
								<th class="th">Public Key</th>
								<th class="th">Remote Address</th>
								<th class="th">Connected At</th>
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
