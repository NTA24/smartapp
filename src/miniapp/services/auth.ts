import { getApiBase, getMiniAppAppId, DEFAULT_SCOPES } from "../lib/config";
import { getAuthCode as apiGetAuthCode } from "../../api/authentication/getAuthCode";
import { authorize } from "../../api/permissions/authorize";
import { getLocation } from "../../api/location/getLocation";
const WV_READY_TIMEOUT_MS = 10_000;
const LAST_AUTH_CODE_KEY = "miniapp_last_auth_code";

function saveLastAuthCode(authCode: string): void {
  try {
    sessionStorage.setItem(LAST_AUTH_CODE_KEY, authCode);
  } catch {}
}

export function isWindVaneReady(): boolean {
  return typeof window !== "undefined" && !!window.WindVane && typeof window.WindVane.call === "function";
}

type WvListener = () => void;
const _wvListeners: WvListener[] = [];
let _wvReady = false;

function notifyWvReady() {
  if (_wvReady) return;
  _wvReady = true;
  for (const fn of _wvListeners.splice(0)) fn();
}

if (typeof window !== "undefined") {
  if (isWindVaneReady()) {
    _wvReady = true;
  } else {
    try {
      let _wvValue = (window as unknown as Record<string, unknown>).WindVane;
      Object.defineProperty(window, "WindVane", {
        configurable: true,
        enumerable: true,
        get() { return _wvValue; },
        set(v: unknown) {
          _wvValue = v;
          if (v && typeof (v as Record<string, unknown>).call === "function") {
            Object.defineProperty(window, "WindVane", {
              configurable: true, enumerable: true, writable: true, value: v,
            });
            notifyWvReady();
          }
        },
      });
    } catch {
      /* property trap not supported — fall back to event + timeout */
    }

    if (typeof document !== "undefined") {
      document.addEventListener("WindVaneReady", () => {
        if (isWindVaneReady()) notifyWvReady();
      }, { once: true });
    }
  }
}

export function onWindVaneReady(): Promise<void> {
  if (_wvReady) return Promise.resolve();

  return new Promise<void>((resolve) => {
    if (isWindVaneReady()) {
      notifyWvReady();
      return resolve();
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    _wvListeners.push(finish);

    setTimeout(() => {
      if (!done) finish();
    }, WV_READY_TIMEOUT_MS);
  });
}


const BASIC_FALLBACK_SCOPES = ["auth_user"];
const PHONE_FALLBACK_SCOPES = ["auth_user", "auth_phone"];

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err ?? "");
}

async function ensurePermissions(scopes: string[]): Promise<void> {
  try {
    await authorize("location");
  } catch {}

  try {
    await getLocation({});
  } catch {}

  for (const scope of scopes) {
    try {
      await authorize(scope);
    } catch {}
  }
}

async function tryGetAuthCode(appId: string, scopes: string[]): Promise<{ authCode: string; scopes: string[] }> {
  const result = await apiGetAuthCode(appId, scopes);
  return { authCode: result.authCode, scopes };
}

function getFallbackScopes(scopes: string[]): string[] {
  const requiresPhone = scopes.some((scope) =>
    scope === "USER_PHONE_NUMBER" || scope === "auth_phone"
  );
  return requiresPhone ? PHONE_FALLBACK_SCOPES : BASIC_FALLBACK_SCOPES;
}

async function getAuthCodeWithRetry(
  scopes: string[],
  attempt = 0
): Promise<{ authCode: string; scopes: string[] }> {
  try {
    await onWindVaneReady();
    if (!isWindVaneReady()) {
      throw new Error("WindVane chưa sẵn sàng");
    }

    const appId = getMiniAppAppId();
    if (!appId) {
      throw new Error("appId đang rỗng");
    }

    await ensurePermissions(scopes);

    try {
      const first = await tryGetAuthCode(appId, scopes);
      saveLastAuthCode(first.authCode);
      return first;
    } catch (firstErr: unknown) {
      const firstMsg = errorMessage(firstErr);
      const isLocationOrConsentError =
        /no location permission|No consent data available|consent|HY_FAILED/i.test(firstMsg);

      if (isLocationOrConsentError) {
        await ensurePermissions(scopes);
        try {
          const second = await tryGetAuthCode(appId, scopes);
          saveLastAuthCode(second.authCode);
          return second;
        } catch {
          const fallbackScopes = getFallbackScopes(scopes);
          const usedFallback =
            fallbackScopes.length !== scopes.length ||
            fallbackScopes.some((scope, index) => scope !== scopes[index]);
          if (usedFallback) {
            try {
              await ensurePermissions(fallbackScopes);
              const fallback = await tryGetAuthCode(appId, fallbackScopes);
              saveLastAuthCode(fallback.authCode);
              return fallback;
            } catch {
              /* fall through */
            }
          }
          throw new Error(
            "Chưa có quyền truy cập (No consent data available). Vui lòng vào Tammi → Cài đặt → Quyền Mini App → bật Vị trí và Số điện thoại cho app này, rồi mở lại và bấm Cho phép."
          );
        }
      }
      throw firstErr;
    }
  } catch (err) {
    const msg = errorMessage(err);
    const isNotReady = msg.includes("WindVane") && (msg.includes("not available") || msg.includes("chưa sẵn sàng"));
    if (isNotReady && attempt < 3) {
      await new Promise<void>((r) => setTimeout(r, 400));
      return getAuthCodeWithRetry(scopes, attempt + 1);
    }
    throw err;
  }
}


export function getAuthCode(scopes: string[] = [...DEFAULT_SCOPES]): Promise<{ authCode: string; scopes: string[] }> {
  return getAuthCodeWithRetry(scopes, 0);
}

export interface SuperAppLoginResult {
  success: boolean;
  data?: { phoneNumber?: string; user?: { phoneNumber?: string; msisdn?: string } };
  error?: string;
  message?: string;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function parseSuperAppLoginResult(data: unknown): SuperAppLoginResult {
  const record = asRecord(data);
  if (!record || typeof record.success !== "boolean") {
    throw new Error("Invalid superapp-login response");
  }
  const dataRecord = asRecord(record.data);
  const userRecord = asRecord(dataRecord?.user);
  return {
    success: record.success,
    data: dataRecord
      ? {
          ...(typeof dataRecord.phoneNumber === "string" ? { phoneNumber: dataRecord.phoneNumber } : {}),
          ...(userRecord
            ? {
                user: {
                  ...(typeof userRecord.phoneNumber === "string" ? { phoneNumber: userRecord.phoneNumber } : {}),
                  ...(typeof userRecord.msisdn === "string" ? { msisdn: userRecord.msisdn } : {}),
                },
              }
            : {}),
        }
      : undefined,
    ...(typeof record.error === "string" ? { error: record.error } : {}),
    ...(typeof record.message === "string" ? { message: record.message } : {}),
  };
}

export async function loginMiniApp(
  scopes: string[] = [...DEFAULT_SCOPES]
): Promise<SuperAppLoginResult> {
  const auth = await getAuthCode(scopes);
  const apiBase = getApiBase();
  const superappLoginUrl = `${apiBase}/auth/superapp-login`;
  const res = await fetch(superappLoginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authCode: auth.authCode,
      scopes: auth.scopes,
      appId: getMiniAppAppId(),
    }),
  });
  const raw = await res.json().catch(() => null);
  const data = parseSuperAppLoginResult(raw);
  return data;
}

export function getPhoneFromLoginResult(data: SuperAppLoginResult): string {
  if (!data?.data) return "";
  const d = data.data;
  if (typeof d === "string") return d;
  if (d.phoneNumber) return d.phoneNumber;
  const u = d.user;
  if (u?.phoneNumber) return u.phoneNumber;
  if (u?.msisdn) return String(u.msisdn);
  return "";
}
