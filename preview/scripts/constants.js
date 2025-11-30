export const STORAGE_KEY = "mornoning_app_state_v1";

function resolveApiBase() {
  if (typeof window === "undefined") return "";
  if (window.__APP_API_BASE__) return window.__APP_API_BASE__;

  const origin = window.location.origin || "";
  if (origin.startsWith("file://")) {
    return "http://localhost:4000";
  }

  return ""; // 동일 호스트
}

export const API_BASE = resolveApiBase();
