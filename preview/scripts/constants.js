export const STORAGE_KEY = "mornoning_app_state_v1";
const API_BASE_STORAGE_KEY = "mornoning_api_base";

function normalizeBase(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

function readStoredBase() {
  try {
    return normalizeBase(window.localStorage?.getItem(API_BASE_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

function persistBase(value) {
  try {
    if (value) {
      window.localStorage?.setItem(API_BASE_STORAGE_KEY, value);
    }
  } catch {
    /* ignore persistence errors */
  }
}

function resolveFromQuery() {
  try {
    const url = new URL(window.location.href);
    const param = url.searchParams.get("apiBase");
    return normalizeBase(param);
  } catch {
    return "";
  }
}

function resolveFromMeta() {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector("meta[name='app-api-base']");
  return normalizeBase(meta?.content || "");
}

function resolveApiBase() {
  if (typeof window === "undefined") return "";

  const fromWindow = normalizeBase(window.__APP_API_BASE__);
  if (fromWindow) return fromWindow;

  const fromQuery = resolveFromQuery();
  if (fromQuery) {
    persistBase(fromQuery);
    return fromQuery;
  }

  const fromStorage = readStoredBase();
  if (fromStorage) return fromStorage;

  const fromMeta = resolveFromMeta();
  if (fromMeta) return fromMeta;

  const origin = window.location.origin || "";
  if (origin.startsWith("file://")) {
    return "http://localhost:4000";
  }

  return ""; // 동일 호스트
}

export const API_BASE = resolveApiBase();
