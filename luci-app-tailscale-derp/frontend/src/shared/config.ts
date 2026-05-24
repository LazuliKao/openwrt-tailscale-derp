export const pendingStatusStorageKey = "tailscale-derp.pendingStatus";

export type ExpectedStatus = {
  enabled: boolean;
  listen: string;
  stun: boolean;
  mesh: boolean;
  metrics: string;
  health: string;
  savedAt?: number;
};

type FormMap = LuCI.form.CBIMap;
type FormOption = LuCI.form.CBIAbstractValue;

export function isSocketAddress(value: string): boolean {
  return /^(:\d+|[^\s:]+:\d+)$/.test(value);
}

export function validateSocketAddress(title: string, value: string): true | string {
  if (!value) {
    return `${title} is required`;
  }

  if (!isSocketAddress(value)) {
    return `${title} must be in :port or host:port format`;
  }

  return true;
}

export function isLoopbackSocketAddress(value: string): boolean {
  return /^(127\.0\.0\.1:\d+|localhost:\d+|\[::1\]:\d+)$/.test(value);
}

export function validateLoopbackSocketAddress(title: string, value: string): true | string {
  if (!value) {
    return `${title} is required`;
  }

  if (!isLoopbackSocketAddress(value)) {
    return `${title} must stay on loopback (127.0.0.1:port, localhost:port, or [::1]:port)`;
  }

  return true;
}

export function firstOption(map: FormMap, sectionId: string, optionName: string): FormOption | null {
  const options = map.lookupOption(optionName, sectionId);
  return options ? options[0] : null;
}

export function optionFormValue(map: FormMap, sectionId: string, optionName: string, fallback: string): string {
  const option = firstOption(map, sectionId, optionName);
  const value = option?.formvalue(sectionId);
  return value == null || value === "" ? fallback : String(value);
}

export function boolFormValue(map: FormMap, sectionId: string, optionName: string, fallback: boolean): boolean {
  const value = optionFormValue(map, sectionId, optionName, fallback ? "1" : "0");
  return value === "1" || value === "true";
}

export function captureExpectedStatus(map: FormMap): ExpectedStatus {
  return {
    enabled: boolFormValue(map, "global", "enabled", false),
    listen: optionFormValue(map, "global", "listen", ":3478"),
    stun: boolFormValue(map, "global", "stun", true),
    mesh: boolFormValue(map, "mesh", "enabled", false),
    metrics: optionFormValue(map, "ops", "metrics", "127.0.0.1:9911"),
    health: optionFormValue(map, "ops", "health", ":9912")
  };
}

export function savePendingStatus(expectedStatus: ExpectedStatus): void {
  if (!window.sessionStorage) {
    return;
  }

  const payload: ExpectedStatus = {
    ...expectedStatus,
    savedAt: Date.now()
  };
  window.sessionStorage.setItem(pendingStatusStorageKey, JSON.stringify(payload));
}

export function clearPendingStatus(): void {
  if (window.sessionStorage) {
    window.sessionStorage.removeItem(pendingStatusStorageKey);
  }
}

export function readPendingStatus(): ExpectedStatus | null {
  if (!window.sessionStorage) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(pendingStatusStorageKey);
    return raw ? (JSON.parse(raw) as ExpectedStatus) : null;
  } catch {
    window.sessionStorage.removeItem(pendingStatusStorageKey);
    return null;
  }
}
