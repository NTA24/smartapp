import { storeGet, storeSet } from "./store";

const STORAGE_KEY_APP_ID = "miniapp_app_id";
export const DEFAULT_MINIAPP_APP_ID = "1512032299590111735808";
const DEFAULT_SMARTAPP_HOSTNAME = "smartapp-ten.vercel.app";
const DEFAULT_PUBLIC_API_BASE = "https://smartapp-ten.vercel.app/api";
const DEFAULT_CAMPUS_API_BASE = "https://campus.iot-platform.io.vn/api/v1/mini-app";
const DEFAULT_LEGACY_USER_INFO_URL =
  "https://campus.iot-platform.io.vn/api/v1/mini-app/oauth/user-info";
const DEFAULT_NEWGEN_API_BASE = "https://newgen.iot-platform.io.vn/api";

function envString(key: string, fallback: string): string {
  const raw = (import.meta.env as Record<string, unknown>)[key];
  const value = String(raw ?? "").trim();
  return value || fallback;
}

const SMARTAPP_HOSTNAME = envString("VITE_SMARTAPP_HOSTNAME", DEFAULT_SMARTAPP_HOSTNAME);
const PUBLIC_API_BASE = envString("VITE_PUBLIC_API_BASE", DEFAULT_PUBLIC_API_BASE);
const CAMPUS_API_BASE = envString("VITE_CAMPUS_API_BASE", DEFAULT_CAMPUS_API_BASE);
const NEWGEN_API_BASE = envString("VITE_NEWGEN_API_BASE", DEFAULT_NEWGEN_API_BASE);

function getAppIdFromUrl(): string {
  if (typeof window === "undefined" || !window.location.search) return "";
  const m = window.location.search.match(/[?&]appId=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function getMiniAppAppId(): string {
  const fromWindow = typeof window !== "undefined" ? (window.MINIAPP_APP_ID ?? window.APP_ID ?? "") : "";
  const fromStorage = typeof window !== "undefined" ? (storeGet(STORAGE_KEY_APP_ID) ?? "") : "";
  const fromUrl = getAppIdFromUrl();
  return String(fromWindow || fromStorage || fromUrl || DEFAULT_MINIAPP_APP_ID).trim();
}

export function saveAppId(appId: string): void {
  if (appId.trim()) storeSet(STORAGE_KEY_APP_ID, appId.trim());
  else try { window.localStorage.removeItem(STORAGE_KEY_APP_ID); } catch {}
}

export function getApiBase(): string {
  if (typeof window !== "undefined" && window.APP_API_BASE_URL) {
    return window.APP_API_BASE_URL;
  }
  const isSameOrigin =
    typeof window !== "undefined" &&
    window.location?.hostname === SMARTAPP_HOSTNAME;
  return isSameOrigin ? "/api" : PUBLIC_API_BASE;
}

export function getTammiExchangeUrl(): string {
  return `${getApiBase().replace(/\/+$/, "")}/exchange-tammi`;
}

export function getLegacyUserInfoUrl(): string {
  return envString("VITE_LEGACY_USER_INFO_URL", DEFAULT_LEGACY_USER_INFO_URL);
}

export const DEFAULT_SCOPES = ["USER_NAME", "USER_PHONE_NUMBER"] as const;
export const SMART_BUILDING_BASE_URL = CAMPUS_API_BASE;
export const NEWGEN_DEVICE_WITH_CREDENTIALS_URL = `${NEWGEN_API_BASE}/device-with-credentials`;

export const NEWGEN_SAMPLE_CUSTOMER_ID = "e08bac50-2dd5-11f1-818c-272cb13706a3";

export function getNewgenSampleDevicesApiKey(): string {
  const raw = (import.meta.env as Record<string, unknown>).VITE_NEWGEN_SAMPLE_DEVICES_API_KEY;
  return String(raw ?? "").trim();
}

export function getNewgenWsJwt(): string {
  let raw = String((import.meta.env as Record<string, unknown>).VITE_NEWGEN_WS_JWT ?? "").trim();
  if (/^bearer\s+/i.test(raw)) raw = raw.replace(/^bearer\s+/i, "").trim();
  return raw;
}

export function getNewgenCustomerDevicesUrl(
  customerId: string,
  opts: { pageSize?: number; page?: number } = {},
): string {
  const pageSize = opts.pageSize ?? 5;
  const page = opts.page ?? 0;
  const q = new URLSearchParams({
    pageSize: String(pageSize),
    page: String(page),
    type: "",
    textSearch: "",
    sortProperty: "",
    sortOrder: "",
  });
  return `${NEWGEN_API_BASE}/customer/${encodeURIComponent(customerId)}/devices?${q.toString()}`;
}

export function getNewgenDeviceSharedScopeTelemetryUrl(deviceId: string): string {
  return `${NEWGEN_API_BASE}/plugins/telemetry/DEVICE/${encodeURIComponent(deviceId)}/SHARED_SCOPE`;
}

export function getNewgenDeviceClientScopeTelemetryUrl(deviceId: string): string {
  return `${NEWGEN_API_BASE}/plugins/telemetry/DEVICE/${encodeURIComponent(deviceId)}/CLIENT_SCOPE`;
}

export function getNewgenDeviceServerScopeTelemetryUrl(deviceId: string): string {
  return `${NEWGEN_API_BASE}/plugins/telemetry/DEVICE/${encodeURIComponent(deviceId)}/SERVER_SCOPE`;
}

export function getNewgenDeviceAttributeValuesUrl(
  deviceId: string,
  scope: "SHARED_SCOPE" | "SERVER_SCOPE" | "CLIENT_SCOPE",
  keys: string[],
): string {
  const q = new URLSearchParams({ keys: keys.join(",") });
  return `${NEWGEN_API_BASE}/plugins/telemetry/DEVICE/${encodeURIComponent(deviceId)}/values/attributes/${scope}?${q.toString()}`;
}

export function getNewgenDeviceTimeseriesUrl(
  deviceId: string,
  keys: string[],
  opts: { startTs: number; endTs: number; limit?: number },
): string {
  const q = new URLSearchParams({
    keys: keys.join(","),
    startTs: String(opts.startTs),
    endTs: String(opts.endTs),
    interval: "0",
    agg: "NONE",
    limit: String(Math.max(1, opts.limit ?? 100)),
  });
  return `${NEWGEN_API_BASE}/plugins/telemetry/DEVICE/${encodeURIComponent(deviceId)}/values/timeseries?${q.toString()}`;
}

export function getNewgenWsTelemetryUrl(): string {
  return NEWGEN_API_BASE.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws")) + "/ws";
}

export function getNewgenWsUseCmdsFormat(): boolean {
  const raw = String((import.meta.env as Record<string, unknown>).VITE_NEWGEN_WS_USE_CMDS_FORMAT ?? "")
    .trim()
    .toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
}

export function getNewgenTbUsername(): string {
  return String((import.meta.env as Record<string, unknown>).VITE_NEWGEN_TB_USERNAME ?? "").trim();
}

export function getNewgenTbPassword(): string {
  return String((import.meta.env as Record<string, unknown>).VITE_NEWGEN_TB_PASSWORD ?? "").trim();
}

export function getNewgenApiBase(): string {
  return NEWGEN_API_BASE;
}

export { STORAGE_KEY_APP_ID };
