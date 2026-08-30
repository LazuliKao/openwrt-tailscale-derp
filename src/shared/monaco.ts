const MONACO_VERSION = "0.56.0";
const MONACO_BASE_URL = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}`;
const MONACO_MODULE_URL = `${MONACO_BASE_URL}/+esm`;
const MONACO_STYLE_URL = `${MONACO_BASE_URL}/esm/vs/editor/standalone/browser/standalone-tokens.css`;

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

type MonacoGlobal = typeof globalThis & {
	MonacoEnvironment?: MonacoEnvironment;
};

export type MonacoTextEditor = {
	getValue(): string;
	setValue(value: string): void;
	dispose(): void;
};

let monacoPromise: Promise<MonacoAPI> | undefined;
let workerURLs: string[] | undefined;
let stylesheetPromise: Promise<void> | undefined;

function createWorkerURL(path: string): string {
	const source = `import ${JSON.stringify(`${MONACO_BASE_URL}/esm/${path}`)};`;
	return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

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

function configureWorkers(): void {
	if (workerURLs) return;

	const editorWorkerURL = createWorkerURL("vs/editor/editor.worker.js");
	const jsonWorkerURL = createWorkerURL("vs/language/json/json.worker.js");
	workerURLs = [editorWorkerURL, jsonWorkerURL];

	const runtime = globalThis as MonacoGlobal;
	const previousEnvironment = runtime.MonacoEnvironment;
	runtime.MonacoEnvironment = {
		...previousEnvironment,
		getWorker(moduleId, label) {
			if (previousEnvironment?.getWorker) return previousEnvironment.getWorker(moduleId, label);
			return new Worker(label === "json" ? jsonWorkerURL : editorWorkerURL, { type: "module" });
		},
	};
}

function importRemoteModule<T>(url: string): Promise<T> {
	const dynamicImport = Function("url", "return import(url);") as (moduleURL: string) => Promise<T>;
	return dynamicImport(url);
}

function loadMonaco(): Promise<MonacoAPI> {
	if (monacoPromise) return monacoPromise;

	configureWorkers();
	const promise = Promise.all([importRemoteModule<MonacoAPI>(MONACO_MODULE_URL), loadStylesheet()]).then(([monaco]) => {
		monaco.json.jsonDefaults.setDiagnosticsOptions({
			allowComments: true,
			enableSchemaRequest: false,
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

export async function createMonacoTextEditor(
	container: HTMLElement,
	initialValue: () => string,
	onChange: (value: string) => void,
): Promise<MonacoTextEditor> {
	const monaco = await loadMonaco();
	const model = monaco.editor.createModel(initialValue(), "json");
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
