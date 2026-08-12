export interface AuthCodeResponse {
  authCode: string;
  [key: string]: unknown;
}

const JSAPI_TIMEOUT_MS = 20_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function normalizeAuthCodeResponse(value: unknown): AuthCodeResponse | null {
  const root = asRecord(value);
  const record = asRecord(root?.data) ?? asRecord(root?.result) ?? root;
  if (!record) return null;
  const authCode = String(record.authCode ?? record.auth_code ?? record.code ?? "").trim();
  return authCode ? { ...record, authCode } : null;
}

export const getAuthCode = (
  appId: string,
  scopes: string[] = ["auth_user"]
): Promise<AuthCodeResponse> => {
  return new Promise((resolve, reject) => {
    if (typeof window.WindVane?.call !== "function") {
      reject(
        new Error(
          "WindVane is not available. Please run in Mini App environment."
        )
      );
      return;
    }

    const params = {
      appId,
      scopes,
    };

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("WindVane getAuthCode timeout"));
    }, JSAPI_TIMEOUT_MS);

    window.WindVane.call(
      "wv",
      "getAuthCode",
      params,
      (result: AuthCodeResponse) => {
        if (settled) return;
        const normalized = normalizeAuthCodeResponse(result);
        if (normalized) {
          settled = true;
          window.clearTimeout(timer);
          resolve(normalized);
        } else {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error("No auth code returned"));
        }
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        let message = "";
        try {
          message = error instanceof Error ? error.message : JSON.stringify(error);
        } catch {}
        reject(new Error(message || "Failed to get auth code"));
      }
    );
  });
};

