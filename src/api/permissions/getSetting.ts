export interface AuthSetting {
  [scope: string]: unknown;
}

export interface GetSettingResult {
  authSetting: AuthSetting;
}

const JSAPI_TIMEOUT_MS = 12_000;

export function isPermissionGranted(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return ["true", "1", "authorized", "authorised", "granted", "allow", "allowed", "success"].includes(
    value.trim().toLowerCase(),
  );
}

export function permissionGranted(result: GetSettingResult | null | undefined, scope: string): boolean {
  return isPermissionGranted(result?.authSetting?.[scope]);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.msg ?? record.error;
    if (typeof message === "string" && message.trim()) return message;
  }
  try {
    return JSON.stringify(error) || "Failed to get settings";
  } catch {
    return "Failed to get settings";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function extractAuthSetting(value: unknown): AuthSetting {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const result = asRecord(root?.result);
  const setting = asRecord(root?.authSetting) ?? asRecord(data?.authSetting) ?? asRecord(result?.authSetting);
  return setting ?? {};
}

export const getSetting = (): Promise<GetSettingResult> => {
  return new Promise((resolve, reject) => {
    if (typeof window.WindVane?.call !== "function") {
      reject(
        new Error(
          "WindVane is not available. Please run in Mini App environment."
        )
      );
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("WindVane getSetting timeout"));
    }, JSAPI_TIMEOUT_MS);

    window.WindVane.call(
      "wv",
      "getSetting",
      {},
      (result: GetSettingResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve({ authSetting: extractAuthSetting(result) });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(new Error(errorMessage(error)));
      }
    );
  });
};
