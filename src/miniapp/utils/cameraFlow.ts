import { CAMERA_FLOW_TRACE_KEY } from "../lib/storageKeys";
import { isWindVaneReady, onWindVaneReady } from "../services/auth";

/** MiniAppContext lắng nghe để gọi lại API danh sách thiết bị sau khi thoát màn native (SDK). */
export const MINIAPP_DEVICES_REFRESH_EVENT = "miniapp-devices-refresh";

function requestMiniAppDeviceListRefresh(reason: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(MINIAPP_DEVICES_REFRESH_EVENT, { detail: { reason } }));
  } catch {}
}

export function updateCameraFlowTrace(patch: Record<string, unknown>): void {
  try {
    const prevRaw = sessionStorage.getItem(CAMERA_FLOW_TRACE_KEY);
    const prev = prevRaw ? (JSON.parse(prevRaw) as Record<string, unknown>) : {};
    sessionStorage.setItem(CAMERA_FLOW_TRACE_KEY, JSON.stringify({ ...prev, ...patch }));
  } catch {}
}

interface CameraJsapiResponse {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return JSON.stringify(err ?? {});
}

export type CameraTypeView = "LIVE" | "MULTIVIEW" | "ADDDEVICES";

export function callMakeCallFromCamera(
  token: string,
  cameraUIDs: string[] = [],
  typeView: CameraTypeView = "LIVE",
): Promise<unknown> {
  const normalizedUIDs = Array.isArray(cameraUIDs)
    ? cameraUIDs.map((v) => String(v).trim()).filter(Boolean)
    : [];
  return new Promise((resolve, reject) => {
    const call = window.WindVane?.call;
    if (typeof call !== "function") {
      reject(new Error("WindVane.call không khả dụng (không chạy trong SuperApp/WebView?)"));
      return;
    }
    call(
      "IOTPlatFormService",
      "makeCallFromCamera",
      { token, cameraUIDs: normalizedUIDs, typeView },
      (res: unknown) => {
        const payload = (res && typeof res === "object" ? res : {}) as CameraJsapiResponse;
        if (payload.success !== true) {
          const msg = String(payload.message ?? "") || "makeCallFromCamera failed";
          reject(new Error(msg));
          return;
        }
        resolve(payload);
      },
      (err: unknown) => {
        const msg = getErrorMessage(err);
        reject(new Error(msg || "makeCallFromCamera failed"));
      },
    );
  }).finally(() => {
    requestMiniAppDeviceListRefresh("makeCallFromCamera:settled");
  });
}


export async function runMakeCallFromCameraFlow(
  token: string,
  cameraUIDs: string[],
  source: string,
  typeView: CameraTypeView = "LIVE",
): Promise<void> {
  /* ADDDEVICES: luồng thêm thiết bị — thường gọi với cameraUIDs rỗng, native xử lý QR / nhập tay */
  const t = String(token ?? "").trim();
  if (!t) throw new Error("Chưa có cameraToken. Hãy đăng nhập lại.");

  updateCameraFlowTrace({
    jsapiStatus: "calling",
    jsapiCalledAt: new Date().toISOString(),
    source,
  });

  try {
    await onWindVaneReady();
    if (!isWindVaneReady()) throw new Error("WindVane chưa sẵn sàng.");
    await callMakeCallFromCamera(t, cameraUIDs, typeView);
    updateCameraFlowTrace({
      jsapiStatus: "success",
      jsapiResponseAt: new Date().toISOString(),
      source,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateCameraFlowTrace({ jsapiStatus: "error", jsapiError: msg, source });
    throw err;
  }
}

export function extractCameraToken(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const candidates = [
    p.cameraToken,
    p.zyToken,
    p.token,
    (p.data as Record<string, unknown> | undefined)?.cameraToken,
    (p.data as Record<string, unknown> | undefined)?.zyToken,
    (p.data as Record<string, unknown> | undefined)?.token,
    (p.result as Record<string, unknown> | undefined)?.cameraToken,
    (p.result as Record<string, unknown> | undefined)?.token,
  ];
  for (const c of candidates) {
    const v = String(c ?? "").trim();
    if (v) return v;
  }
  return "";
}

export function extractCameraUIDs(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const raw = p.cameraUIDs;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      return String((item as Record<string, unknown>).deviceId ?? "").trim();
    })
    .filter(Boolean);
}
