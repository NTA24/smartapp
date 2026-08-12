import { isPermissionGranted } from "./getSetting";

export type PermissionScope =
  | "location"
  | "camera"
  | "bluetooth"
  | "album"
  | "contacts"
  | "microphone"
  | "file"
  | "call"
  | "vibrate"
  | "screen";

export type AuthorizeScope = PermissionScope;

export interface AuthorizeResult {
  successScope?: Record<string, unknown>;
  msg?: string;
  [key: string]: unknown;
}

const JSAPI_TIMEOUT_MS = 12_000;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  try {
    return JSON.stringify(error) || "Failed to authorize";
  } catch {
    return "Failed to authorize";
  }
}

function explicitPermissionState(value: unknown): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "1", "authorized", "authorised", "granted", "allow", "allowed", "success"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "denied", "unauthorized", "unauthorised", "rejected", "disallow", "disallowed", "failed"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function callbackGranted(result: AuthorizeResult | null | undefined, scope: string): boolean | undefined {
  const root = result as Record<string, unknown> | null | undefined;
  const data = root?.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : null;
  const nestedResult = root?.result && typeof root.result === "object"
    ? root.result as Record<string, unknown>
    : null;
  const values =
    result?.successScope ??
    (data?.successScope && typeof data.successScope === "object"
      ? data.successScope as Record<string, unknown>
      : nestedResult?.successScope && typeof nestedResult.successScope === "object"
        ? nestedResult.successScope as Record<string, unknown>
      : undefined);
  if (values && scope in values) {
    return explicitPermissionState(values[scope]) ?? isPermissionGranted(values[scope]);
  }
  const records = [nestedResult, data, root];
  for (const record of records) {
    if (!record) continue;
    for (const key of ["authorized", "granted", "success", "status", "permission"]) {
      const state = explicitPermissionState(record[key]);
      if (state !== undefined) return state;
    }
  }
  return undefined;
}

const buildSuccessResult = (
  scope: AuthorizeScope,
  msg = "Permission granted"
): AuthorizeResult => ({
  successScope: { [scope]: true },
  msg,
});

export const authorize = async (
  scope: AuthorizeScope
): Promise<AuthorizeResult> => {
  if (typeof window.WindVane?.call !== "function") {
    throw new Error(
      "WindVane is not available. Please run in Mini App environment."
    );
  }

  return new Promise((resolve, reject) => {
    const wv = window.WindVane;
    if (typeof wv?.call !== "function") {
      reject(new Error("WindVane is not available."));
      return;
    }
    let settled = false;
    const finishResolve = (result: AuthorizeResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    };
    const timer = window.setTimeout(() => {
      finishReject(new Error(`WindVane authorize timeout: ${scope}`));
    }, JSAPI_TIMEOUT_MS);

    wv.call(
      "wv",
      "authorize",
      { scope },
      async (result: AuthorizeResult) => {
        if (settled) return;
        const callbackState = callbackGranted(result, scope);
        if (callbackState === false) {
          finishReject(new Error(`Permission denied: ${scope}`));
          return;
        }
        finishResolve(result ?? buildSuccessResult(scope));
      },
      (error: unknown) => {
        if (settled) return;
        finishReject(new Error(errorMessage(error)));
      }
    );
  });
};
