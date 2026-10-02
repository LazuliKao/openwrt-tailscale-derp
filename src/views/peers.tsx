type PeerIdentity = {
	source: "official_api" | "local_tailscaled";
	name?: string;
	hostname?: string;
	user?: string;
	nodeId?: string;
	addresses?: string[];
	os?: string;
	clientVersion?: string;
	tags?: string[];
	sources?: string[];
};

type PeerConnection = {
	remoteAddr: string;
	connectedAt: string;
};

type PeerInfo = {
	publicKey: string;
	remoteAddr: string;
	connectedAt: string;
	connections: PeerConnection[];
	bytesRecv: number;
	bytesSent: number;
	recvBytesPerSecond: number | null;
	sentBytesPerSecond: number | null;
	identity: PeerIdentity | null;
};

type PeersResponse = {
	peers: PeerInfo[];
	count: number;
	sampledAt: string;
};

const callPeers = L.rpc.declare<PeersResponse>({
	object: "luci.tailscale-derp",
	method: "get_peers",
});

function formatPublicKey(key: string): string {
	return key.length > 24 ? `${key.slice(0, 20)}…` : key;
}

function formatTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatDuration(iso: string): string {
	const start = new Date(iso).getTime();
	if (Number.isNaN(start)) return "-";
	const seconds = Math.floor(Math.max(0, Date.now() - start) / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days) return _("%dd %dh %dm").format(days, hours % 24, minutes % 60);
	if (hours) return _("%dh %dm %ds").format(hours, minutes % 60, seconds % 60);
	if (minutes) return _("%dm %ds").format(minutes, seconds % 60);
	return _("%ds").format(seconds);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatRate(rate: number | null): string {
	return rate == null ? _("Sampling…") : `${formatBytes(rate)}/s`;
}

function identityName(peer: PeerInfo): string {
	return peer.identity?.name || peer.identity?.hostname || _("Unknown device");
}

function identitySource(identity: PeerIdentity | null): string {
	if (!identity) return _("Unknown or resolving");
	return identity.source === "official_api" ? _("Tailscale API") : _("Local tailscaled");
}

function detail(label: string, value: string): HTMLElement {
	return (
		<div class="cbi-value" style="padding: 0.3em 0;">
			<label class="cbi-value-title">{label}</label>
			<div class="cbi-value-field" style="overflow-wrap: anywhere;">{value || "-"}</div>
		</div>
	);
}

function optionalDetail(label: string, value: string | undefined): HTMLElement | null {
	return value ? detail(label, value) : null;
}

function peerDetails(peer: PeerInfo): HTMLElement {
	const identity = peer.identity;
	return (
		<div>
			{detail(_("Device"), identityName(peer))}
			{detail(_("Identity Source"), identitySource(identity))}
			{detail(_("Node Key"), peer.publicKey)}
			{optionalDetail(_("Node ID"), identity?.nodeId)}
			{optionalDetail(_("Hostname"), identity?.hostname)}
			{optionalDetail(_("User"), identity?.user)}
			{optionalDetail(_("Addresses"), identity?.addresses?.join(", "))}
			{optionalDetail(_("OS"), identity?.os)}
			{optionalDetail(_("Client Version"), identity?.clientVersion)}
			{optionalDetail(_("Tags"), identity?.tags?.join(", "))}
			{optionalDetail(_("Sources"), identity?.sources?.join(", "))}
			{detail(_("Duration"), formatDuration(peer.connectedAt))}
			{detail(_("Connected At"), formatTime(peer.connectedAt))}
			{detail(_("Received (DERP payload)"), formatBytes(peer.bytesRecv))}
			{detail(_("Sent (DERP payload)"), formatBytes(peer.bytesSent))}
			{detail(_("Receive rate (5s)"), formatRate(peer.recvBytesPerSecond))}
			{detail(_("Send rate (5s)"), formatRate(peer.sentBytesPerSecond))}
			<h4>{_("Connections")} ({peer.connections.length})</h4>
			{peer.connections.map((connection) => (
				<div style="padding: 0.4em 0; border-top: 1px solid #ddd; overflow-wrap: anywhere;">
					{connection.remoteAddr} · {formatTime(connection.connectedAt)}
				</div>
			))}
		</div>
	);
}

type PeersView = {
	listEl: HTMLElement;
	countEl: HTMLElement;
	errorEl: HTMLElement;
	lastUpdatedEl: HTMLElement;
	peers: PeerInfo[];
	selectedKey: string | null;
	dialogBody: HTMLElement | null;
};

function showDetails(view: PeersView, peer: PeerInfo): void {
	const body = <div>{peerDetails(peer)}</div>;
	view.selectedKey = peer.publicKey;
	view.dialogBody = body;
	L.ui.showModal(_("Peer Details"), (
		<div>
			{body}
			<div style="margin-top: 1em; text-align: right;">
				<button class="cbi-button cbi-button-neutral" type="button" onclick={() => {
					view.selectedKey = null;
					view.dialogBody = null;
					L.ui.hideModal();
				}}>{_("Close")}</button>
			</div>
		</div>
	));
}

function peerCard(view: PeersView, peer: PeerInfo): HTMLElement {
	return (
		<div style="flex: 1 1 250px; min-width: 0; padding: 0.8em; border: 1px solid #ddd; border-radius: 4px; overflow-wrap: anywhere;">
			<div style="font-weight: bold;">{identityName(peer)}</div>
			<div style="font-family: monospace; font-size: 0.85em;" title={peer.publicKey}>{formatPublicKey(peer.publicKey)}</div>
			<div style="margin-top: 0.4em;">{peer.remoteAddr}</div>
			<div style="margin-top: 0.4em;">↓ {formatRate(peer.recvBytesPerSecond)} · ↑ {formatRate(peer.sentBytesPerSecond)}</div>
			<button class="cbi-button cbi-button-neutral" type="button" style="margin-top: 0.6em;" onclick={() => showDetails(view, peer)}>
				{_("Details")}
			</button>
		</div>
	);
}

function updatePeers(view: PeersView, peers: PeerInfo[]): void {
	view.peers = peers;
	view.countEl.textContent = _("%d connected peer(s)").format(peers.length);
	view.listEl.replaceChildren(...(peers.length ? peers.map((peer) => peerCard(view, peer)) : [<p>{_("No connected peers")}</p>]));
	if (view.dialogBody && view.selectedKey) {
		const selected = peers.find((peer) => peer.publicKey === view.selectedKey);
		view.dialogBody.replaceChildren(selected ? peerDetails(selected) : <p>{_("Peer disconnected")}</p>);
	}
}

function pollPeers(view: PeersView): Promise<void> {
	return callPeers().then((response) => {
		updatePeers(view, response?.peers || []);
		view.errorEl.textContent = "";
		view.lastUpdatedEl.textContent = _("Last updated: %s").format(new Date().toLocaleTimeString());
	}).catch((error: unknown) => {
		view.errorEl.textContent = error instanceof Error ? error.message : _("Backend unavailable");
	});
}

export const main = (L.view as any).extend({
	load() {
		return callPeers().catch(() => ({ peers: [], count: 0, sampledAt: "" }));
	},

	render(this: PeersView, response: PeersResponse) {
		const countEl = <div style="margin-bottom: 0.75em;"></div>;
		const errorEl = <div style="margin-bottom: 0.5em; min-height: 1.2em; color: #cf222e;"></div>;
		const lastUpdatedEl = <div style="margin-bottom: 0.5em; font-size: 0.9em;"></div>;
		const listEl = <div style="display: flex; flex-wrap: wrap; gap: 0.75em;"></div>;
		this.listEl = listEl;
		this.countEl = countEl;
		this.errorEl = errorEl;
		this.lastUpdatedEl = lastUpdatedEl;
		this.selectedKey = null;
		this.dialogBody = null;
		updatePeers(this, response?.peers || []);
		L.Poll.add(() => pollPeers(this), 5);

		return (
			<div>
				<h2>{_("DERP Connected Peers")}</h2>
				<div class="cbi-section">
					<h3>{_("Connected Peers")}</h3>
					{countEl}
					<p style="font-size: 0.9em;">{_("Traffic counts DERP packet payload only; rates update about every 5 seconds.")}</p>
					{lastUpdatedEl}
					{errorEl}
					{listEl}
				</div>
			</div>
		);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
});
