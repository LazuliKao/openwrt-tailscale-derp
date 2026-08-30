const MONACO_VERSION = "0.56.0";
const MONACO_BASE_URL = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}`;
const MONACO_MODULE_URL = `https://esm.sh/monaco-editor@${MONACO_VERSION}?bundle`;
const MONACO_EDITOR_WORKER_URL = `https://esm.sh/monaco-editor@${MONACO_VERSION}/esm/vs/editor/editor.worker?worker`;
const MONACO_JSON_WORKER_URL = `https://esm.sh/monaco-editor@${MONACO_VERSION}/esm/vs/language/json/json.worker?worker`;
const MONACO_STYLE_URL = `${MONACO_BASE_URL}/min/vs/editor/editor.main.css`;
const ACL_SCHEMA_URL = "https://raw.githubusercontent.com/joneskoo/tailscale/claude/tailscale-acl-json-schema-v2/acl-schema.json";
// Tailscale's request for an official ACL schema: https://github.com/tailscale/tailscale/issues/10794

type MonacoModel = {
	getValue(): string;
	setValue(value: string): void;
	dispose(): void;
	onDidChangeContent(listener: () => void): { dispose(): void };
};

type MonacoEditor = {
	dispose(): void;
};

type MonacoAPI = {
	editor: {
		createModel(value: string, language: string): MonacoModel;
		create(container: HTMLElement, options: Record<string, unknown>): MonacoEditor;
		setTheme(theme: string): void;
	};
	json: {
		jsonDefaults: {
			setDiagnosticsOptions(options: Record<string, unknown>): void;
		};
	};
};

type MonacoEnvironment = {
	getWorker?: (moduleId: string, label: string) => Worker;
};

type MonacoWorkerModule = {
	default(): Worker;
};

type MonacoGlobal = typeof globalThis & {
	MonacoEnvironment?: MonacoEnvironment;
};

export type MonacoTextEditor = {
	getValue(): string;
	setValue(value: string): void;
	dispose(): void;
};

let monacoPromise: Promise<MonacoAPI> | undefined;
let stylesheetPromise: Promise<void> | undefined;
let schemaPromise: Promise<Record<string, unknown> | undefined> | undefined;

function loadStylesheet(): Promise<void> {
	if (stylesheetPromise) return stylesheetPromise;

	stylesheetPromise = new Promise<void>((resolve, reject) => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = MONACO_STYLE_URL;
		link.onload = () => resolve();
		link.onerror = () => reject(new Error("Unable to load Monaco stylesheet."));
		document.head.appendChild(link);
	});

	void stylesheetPromise.catch(() => {
		stylesheetPromise = undefined;
	});
	return stylesheetPromise;
}

function configureWorkers(editorWorker: MonacoWorkerModule, jsonWorker: MonacoWorkerModule): void {
	const runtime = globalThis as MonacoGlobal;
	const previousEnvironment = runtime.MonacoEnvironment;
	runtime.MonacoEnvironment = {
		...previousEnvironment,
		getWorker(moduleId, label) {
			if (previousEnvironment?.getWorker) return previousEnvironment.getWorker(moduleId, label);
			return (label === "json" ? jsonWorker : editorWorker).default();
		},
	};
}

function importRemoteModule<T>(url: string): Promise<T> {
	const dynamicImport = Function("url", "return import(url);") as (moduleURL: string) => Promise<T>;
	return dynamicImport(url);
}

function loadSchema(): Promise<Record<string, unknown> | undefined> {
	if (schemaPromise) return schemaPromise;

	schemaPromise = fetch(ACL_SCHEMA_URL)
		.then((response) => {
			if (!response.ok) throw new Error("Unable to load the Tailscale ACL schema.");
			return response.json() as Promise<Record<string, unknown>>;
		})
		.catch(() => undefined);
	return schemaPromise;
}

function loadMonaco(): Promise<MonacoAPI> {
	if (monacoPromise) return monacoPromise;

	const promise = Promise.all([
		importRemoteModule<MonacoAPI>(MONACO_MODULE_URL),
		importRemoteModule<MonacoWorkerModule>(MONACO_EDITOR_WORKER_URL),
		importRemoteModule<MonacoWorkerModule>(MONACO_JSON_WORKER_URL),
		loadStylesheet(),
		loadSchema(),
	]).then(([monaco, editorWorker, jsonWorker, , schema]) => {
		configureWorkers(editorWorker, jsonWorker);
		monaco.json.jsonDefaults.setDiagnosticsOptions({
			allowComments: true,
			enableSchemaRequest: false,
			schemas: schema ? [{ fileMatch: ["*"], schema, uri: ACL_SCHEMA_URL }] : [],
			trailingCommas: "ignore",
			validate: true,
		});
		return monaco;
	});

	monacoPromise = promise;
	void promise.catch(() => {
		if (monacoPromise === promise) monacoPromise = undefined;
	});
	return promise;
}

function backgroundLuminance(element: HTMLElement): number | undefined {
	const color = getComputedStyle(element).backgroundColor.match(/\d+/g)?.map(Number);
	if (!color || color.length < 3 || color[3] === 0) return undefined;
	return color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114;
}

function prefersDarkTheme(): boolean {
	for (const element of [document.body, document.documentElement]) {
		const luminance = backgroundLuminance(element);
		if (luminance !== undefined) return luminance < 128;
	}
	return matchMedia("(prefers-color-scheme: dark)").matches;
}

export async function createMonacoTextEditor(
	container: HTMLElement,
	initialValue: () => string,
	onChange: (value: string) => void,
): Promise<MonacoTextEditor> {
	const monaco = await loadMonaco();
	const model = monaco.editor.createModel(initialValue(), "json");
	monaco.editor.setTheme(prefersDarkTheme() ? "vs-dark" : "vs");
	const editor = monaco.editor.create(container, {
		automaticLayout: true,
		minimap: { enabled: false },
		model,
		scrollBeyondLastLine: false,
		tabSize: 2,
		wordWrap: "on",
	});
	const changeListener = model.onDidChangeContent(() => onChange(model.getValue()));

	return {
		getValue: () => model.getValue(),
		setValue(value) {
			model.setValue(value);
		},
		dispose() {
			changeListener.dispose();
			editor.dispose();
			model.dispose();
		},
	};
}
