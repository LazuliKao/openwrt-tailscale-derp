import {
	callSetTailnetACL,
	callTailnetACL,
	callTailnets,
	callValidateTailnetACL,
	type TailnetInstance,
	type TailnetsResponse,
} from "@/shared/tailnets";

type TailnetsView = {
	selectEl: HTMLSelectElement;
	metadataEl: HTMLElement;
	policyEl: HTMLTextAreaElement;
	messageEl: HTMLElement;
	loadEl: HTMLButtonElement;
	validateEl: HTMLButtonElement;
	saveEl: HTMLButtonElement;
	tailnets: TailnetInstance[];
	instance: string;
	etag: string;
};

const view = L.view;

function selectedTailnet(viewState: TailnetsView): TailnetInstance | undefined {
	return viewState.tailnets.find((tailnet) => tailnet.name === viewState.instance);
}

function setMessage(viewState: TailnetsView, message: string, color = ""): void {
	viewState.messageEl.style.color = color;
	viewState.messageEl.textContent = message;
}

function setActionState(viewState: TailnetsView, disabled: boolean): void {
	viewState.loadEl.disabled = disabled;
	viewState.validateEl.disabled = disabled;
	viewState.saveEl.disabled = disabled;
}

function renderMetadata(viewState: TailnetsView): void {
	const tailnet = selectedTailnet(viewState);
	if (!tailnet) {
		viewState.metadataEl.replaceChildren(<p>{_("Select a configured API instance to manage its ACL policy.")}</p>);
		return;
	}
	viewState.metadataEl.replaceChildren(
		<div class="cbi-value">
			<label class="cbi-value-title">{_("Tailnet")}</label>
			<div class="cbi-value-field">{tailnet.tailnet || "-"}</div>
		</div>,
		<div class="cbi-value">
			<label class="cbi-value-title">{_("Instance")}</label>
			<div class="cbi-value-field" style="font-family: monospace;">{tailnet.name || "-"}</div>
		</div>,
	);
}

function loadPolicy(viewState: TailnetsView, preserveDraft = false): Promise<void> {
	if (!viewState.instance) {
		setMessage(viewState, _("Select an API instance first."), "#cf222e");
		return Promise.resolve();
	}

	const draft = viewState.policyEl.value;
	setActionState(viewState, true);
	setMessage(viewState, _("Loading ACL policy..."));
	return callTailnetACL(viewState.instance)
		.then((response) => {
			if (response?.error) throw new Error(response.error);
			viewState.etag = response?.etag || "";
			if (!preserveDraft) viewState.policyEl.value = response?.hujson || "";
			setMessage(
				viewState,
				preserveDraft
					? _("The server policy changed. Your draft was retained; review it before saving again.")
					: _("ACL policy loaded."),
				preserveDraft ? "#c60" : "#1a7f37",
			);
		})
		.catch((err: unknown) => {
			viewState.policyEl.value = draft;
			setMessage(viewState, err instanceof Error ? err.message : _("Unable to load ACL policy."), "#cf222e");
		})
		.finally(() => {
			setActionState(viewState, false);
		});
}

function validatePolicy(viewState: TailnetsView): void {
	const hujson = viewState.policyEl.value;
	if (!viewState.instance) {
		setMessage(viewState, _("Select an API instance first."), "#cf222e");
		return;
	}
	if (!hujson.trim()) {
		setMessage(viewState, _("ACL policy is required."), "#cf222e");
		return;
	}

	setActionState(viewState, true);
	setMessage(viewState, _("Validating ACL policy..."));
	callValidateTailnetACL(viewState.instance, hujson)
		.then((response) => {
			if (response?.error) throw new Error(response.error);
			setMessage(viewState, _("ACL policy is valid."), "#1a7f37");
		})
		.catch((err: unknown) => {
			setMessage(viewState, err instanceof Error ? err.message : _("ACL policy validation failed."), "#cf222e");
		})
		.finally(() => {
			setActionState(viewState, false);
		});
}

function savePolicy(viewState: TailnetsView): void {
	const hujson = viewState.policyEl.value;
	if (!viewState.instance) {
		setMessage(viewState, _("Select an API instance first."), "#cf222e");
		return;
	}
	if (!hujson.trim() || !viewState.etag) {
		setMessage(viewState, _("Load an ACL policy before saving."), "#cf222e");
		return;
	}

	setActionState(viewState, true);
	setMessage(viewState, _("Saving ACL policy..."));
	callSetTailnetACL(viewState.instance, hujson, viewState.etag)
		.then((response) => {
			if (response?.conflict) return loadPolicy(viewState, true);
			if (response?.error) throw new Error(response.error);
			return loadPolicy(viewState);
		})
		.catch((err: unknown) => {
			setMessage(viewState, err instanceof Error ? err.message : _("Unable to save ACL policy."), "#cf222e");
		})
		.finally(() => {
			setActionState(viewState, false);
		});
}

export const main = (view as any).extend({
	load() {
		return callTailnets().catch(() => ({ instances: [] }));
	},

	render(this: TailnetsView, data: TailnetsResponse) {
		const selectEl = <select class="cbi-input-select" style="min-width: 20em;"></select> as HTMLSelectElement;
		const metadataEl = <div></div>;
		const policyEl = <textarea class="cbi-input-text" rows={24} spellcheck={false} style="box-sizing: border-box; font-family: monospace; resize: vertical; width: 100%;"></textarea> as HTMLTextAreaElement;
		const messageEl = <div style="min-height: 1.2em; margin-top: 0.75em;"></div>;
		const loadEl = <button class="cbi-button cbi-button-action" type="button">{_("Load")}</button> as HTMLButtonElement;
		const validateEl = <button class="cbi-button cbi-button-apply" type="button">{_("Validate")}</button> as HTMLButtonElement;
		const saveEl = <button class="cbi-button cbi-button-save" type="button">{_("Save")}</button> as HTMLButtonElement;
		const tailnets = (data.instances || []).filter((tailnet) => tailnet.configured && tailnet.name);

		const viewState: TailnetsView = {
			selectEl,
			metadataEl,
			policyEl,
			messageEl,
			loadEl,
			validateEl,
			saveEl,
			tailnets,
			instance: "",
			etag: "",
		};

		selectEl.replaceChildren(
			<option value="">{_("Select an API instance")}</option>,
			...tailnets.map((tailnet) => <option value={tailnet.name || ""}>{tailnet.label || tailnet.name}</option>),
		);
		renderMetadata(viewState);
		selectEl.onchange = () => {
			viewState.instance = selectEl.value;
			viewState.etag = "";
			viewState.policyEl.value = "";
			renderMetadata(viewState);
			setMessage(viewState, viewState.instance ? _("Load the ACL policy to begin editing.") : "");
		};
		loadEl.onclick = () => {
			void loadPolicy(viewState);
		};
		validateEl.onclick = () => validatePolicy(viewState);
		saveEl.onclick = () => savePolicy(viewState);

		return (
			<div>
				<h2>{_("Tailnet ACL Management")}</h2>
				<div class="cbi-section">
					<p>{_("Edit the raw HuJSON ACL policy for one configured Tailscale API instance. Saving validates the policy and uses the loaded ETag to prevent overwriting another administrator's changes.")}</p>
					<div class="cbi-value">
						<label class="cbi-value-title">{_("API Instance")}</label>
						<div class="cbi-value-field">{selectEl}</div>
					</div>
					{metadataEl}
				</div>
				<div class="cbi-section">
					<h3>{_("ACL Policy (HuJSON)")}</h3>
					{policyEl}
					<div style="margin-top: 0.75em;">
						{loadEl} {validateEl} {saveEl}
					</div>
					{messageEl}
				</div>
			</div>
		);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,
});
