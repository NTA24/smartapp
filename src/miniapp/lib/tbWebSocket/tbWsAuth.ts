import {
  getNewgenApiBase,
  getNewgenTbPassword,
  getNewgenTbUsername,
} from "../config";
import { addLog } from "../debugLog";

let _cachedLoginJwt = "";
let _loginInFlight: Promise<string | null> | null = null;
let _loginBlockedUntil = 0;

const LOGIN_RETRY_COOLDOWN_MS = 60_000;

export function isJwtExpired(jwt: string): boolean {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload.exp !== "number") return false;
    return payload.exp * 1000 < Date.now() - 60_000;
  } catch {
    return false;
  }
}

export async function tbLogin(): Promise<string | null> {
  if (_loginInFlight) return _loginInFlight;
  if (Date.now() < _loginBlockedUntil) return null;
  _loginInFlight = (async () => {
    try {
      const baseUrl = getNewgenApiBase();
      const username = getNewgenTbUsername();
      const password = getNewgenTbPassword();
      if (!username || !password) return null;
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        addLog("[ws]", `TB login failed: HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { token?: string; refreshToken?: string };
      if (data.token) {
        _cachedLoginJwt = data.token;
        addLog("[ws]", "TB login OK — fresh JWT acquired");
        return data.token;
      }
      return null;
    } catch (e) {
      addLog("[ws]", `TB login error: ${String(e)}`);
      return null;
    } finally {
      _loginInFlight = null;
    }
  })();
  return _loginInFlight;
}

export function getCachedLoginJwt(): string {
  return _cachedLoginJwt;
}

export function clearCachedLoginJwt(): void {
  _cachedLoginJwt = "";
}

export function rejectCachedLoginJwt(): void {
  _cachedLoginJwt = "";
  _loginBlockedUntil = Date.now() + LOGIN_RETRY_COOLDOWN_MS;
}
