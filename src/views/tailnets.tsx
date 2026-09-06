import {
	callSetTailnetACL,
	callTailnetACL,
	callTailnets,
	callValidateTailnetACL,
	type TailnetInstance,
	type TailnetsResponse,
} from "@/shared/tailnets";
import { createMonacoTextEditor, type MonacoSource, type MonacoTextEditor } from "@/shared/monaco";

type TailnetsView = {
	selectEl: HTMLSelectElement;
	metadataEl: HTMLElement;
	policyEl: HTMLTextAreaElement;
	editorEl: HTMLElement;
	editorSettingsEl: HTMLElement;
	editorSourceEl: HTMLSelectElement;
	enableEditorEl: HTMLButtonElement;
	policyEditor?: MonacoTextEditor;
	messageEl: HTMLElement;
	validateEl: HTMLButtonElement;
	saveEl: HTMLButtonElement;
	tailnets: TailnetInstance[];
	instance: string;
	etag: string;
	loadGeneration: number;
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
	viewState.validateEl.disabled = disabled;
	viewState.saveEl.disabled = disabled;
}

function getPolicy(viewState: TailnetsView): string {
	return viewState.policyEditor?.getValue() ?? viewState.policyEl.value;
}

function setPolicy(viewState: TailnetsView, value: string): void {
	viewState.policyEl.value = value;
	viewState.policyEditor?.setValue(value);
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
	const instance = viewState.instance;
	if (!instance) {
		setMessage(viewState, _("Select an API instance first."), "#cf222e");
		return Promise.resolve();
	}

	const loadGeneration = ++viewState.loadGeneration;
	const draft = getPolicy(viewState);
	setActionState(viewState, true);
	setMessage(viewState, _("Loading ACL policy..."));
	return callTailnetACL(instance)
		.then((response) => {
			if (loadGeneration !== viewState.loadGeneration) return;
			if (response?.error) throw new Error(response.error);
			viewState.etag = response?.etag || "";
			if (!preserveDraft) setPolicy(viewState, response?.hujson || "");
			setMessage(
				viewState,
				preserveDraft
					? _("The server policy changed. Your draft was retained; review it before saving again.")
					: _("ACL policy loaded."),
				preserveDraft ? "#c60" : "#1a7f37",
			);
		})
		.catch((err: unknown) => {
			if (loadGeneration !== viewState.loadGeneration) return;
			setPolicy(viewState, draft);
			setMessage(viewState, err instanceof Error ? err.message : _("Unable to load ACL policy."), "#cf222e");
		})
		.finally(() => {
			if (loadGeneration === viewState.loadGeneration) setActionState(viewState, false);
		});
}

function validatePolicy(viewState: TailnetsView): void {
	const hujson = getPolicy(viewState);
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
	const hujson = getPolicy(viewState);
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

function enableAdvancedEditor(viewState: TailnetsView): void {
	const source = viewState.editorSourceEl.value as MonacoSource;
	viewState.editorSourceEl.disabled = true;
	viewState.enableEditorEl.disabled = true;
	setMessage(viewState, _("Loading advanced editor..."));

	void createMonacoTextEditor(
		viewState.editorEl,
		() => viewState.policyEl.value,
		(value) => {
			viewState.policyEl.value = value;
		},
		source,
	)
		.then((editor) => {
			if (!viewState.editorEl.isConnected) {
				editor.dispose();
				return;
			}
			viewState.policyEditor = editor;
			viewState.policyEl.style.display = "none";
			viewState.editorEl.style.display = "block";
			viewState.editorSettingsEl.style.display = "none";
			setMessage(viewState, "");
		})
		.catch(() => {
			viewState.editorSourceEl.disabled = false;
			viewState.enableEditorEl.disabled = false;
			setMessage(viewState, _("Advanced editor could not be loaded; using the plain text editor."), "#c60");
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
		const editorEl = <div style="display: none; height: 36em;"></div>;
		const editorSourceEl = <select class="cbi-input-select"></select> as HTMLSelectElement;
		const enableEditorEl = <button class="cbi-button cbi-button-action" type="button">{_("Enable advanced editor")}</button> as HTMLButtonElement;
		const editorSettingsEl = (
			<div class="cbi-value">
				<label class="cbi-value-title">{_("Advanced editor source")}</label>
				<div class="cbi-value-field">
					{editorSourceEl} {enableEditorEl}
				</div>
			</div>
		);
		const messageEl = <div style="min-height: 1.2em; margin-top: 0.75em;"></div>;
		const validateEl = <button class="cbi-button cbi-button-apply" type="button">{_("Validate")}</button> as HTMLButtonElement;
		const saveEl = <button class="cbi-button cbi-button-save" type="button">{_("Save")}</button> as HTMLButtonElement;
		const tailnets = (data.instances || []).filter((tailnet) => tailnet.configured && tailnet.name);

		const viewState: TailnetsView = {
			selectEl,
			metadataEl,
			policyEl,
			editorEl,
			editorSettingsEl,
			editorSourceEl,
			enableEditorEl,
			messageEl,
			validateEl,
			saveEl,
			tailnets,
			instance: "",
			etag: "",
			loadGeneration: 0,
		};

		selectEl.replaceChildren(
			<option value="">{_("Select an API instance")}</option>,
			...tailnets.map((tailnet) => <option value={tailnet.name || ""}>{tailnet.label || tailnet.name}</option>),
		);
		editorSourceEl.replaceChildren(
			<option value="auto">{_("Automatic (test all CDNs and use the fastest)")}</option>,
			<option value="esm">esm.sh</option>,
			<option value="jsdelivr">jsDelivr</option>,
			<option value="fastly">jsDelivr (Fastly)</option>,
			<option value="gcore">jsDelivr (Gcore)</option>,
			<option value="unpkg">unpkg</option>,
		);
		renderMetadata(viewState);
		selectEl.onchange = () => {
			viewState.loadGeneration++;
			viewState.instance = selectEl.value;
			viewState.etag = "";
			setPolicy(viewState, "");
			renderMetadata(viewState);
			if (viewState.instance) void loadPolicy(viewState);
			else setMessage(viewState, "");
		};
		validateEl.onclick = () => validatePolicy(viewState);
		saveEl.onclick = () => savePolicy(viewState);
		enableEditorEl.onclick = () => enableAdvancedEditor(viewState);

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
					{editorSettingsEl}
					{policyEl}
					{editorEl}
					<div style="margin-top: 0.75em;">
						{validateEl} {saveEl}
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
