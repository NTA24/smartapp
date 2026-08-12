import { getTammiExchangeUrl } from "../../miniapp/lib/config";
import { addLog, clearLogs } from "../../miniapp/lib/debugLog";

const USER_INFO_LOG_MAX = 14_000;

function jsonForUserInfoDebugLog(value: unknown, max = USER_INFO_LOG_MAX): string {
  try {
    const s = JSON.stringify(value, (key, item) => {
      if (/token|authcode|password|secret/i.test(key)) {
        const length = typeof item === "string" ? item.length : 0;
        return `<redacted${length ? `:${length}` : ""}>`;
      }
      return item;
    });
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…(truncated, ${s.length} chars)`;
  } catch {
    return String(value);
  }
}

export interface UserInfoResponse {
  username?: string;
  email?: string;
  fullName?: string;
  phone?: string;
  phoneNumber?: string;
  msisdn?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  zyToken?: string;
  mqttToken?: string;
  cameraToken?: string;
  user?: {
    phone?: string;
    name?: string;
    phoneNumber?: string;
    msisdn?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function mergeResponseRecords(envelope: Record<string, unknown>): Record<string, unknown> {
  const layers = [envelope];
  let current = envelope;
  for (let depth = 0; depth < 3; depth++) {
    const nested = firstRecord(current.data, current.result, current.payload);
    if (!nested) break;
    layers.push(nested);
    current = nested;
  }
  return Object.assign({}, ...layers);
}

function pickErrorMessage(data: unknown): string {
  const record = asRecord(data);
  if (!record) return "";
  if (typeof record.detail === "string") return record.detail;
  if (typeof record.message === "string") return record.message;
  const error = asRecord(record.error);
  if (typeof error?.message === "string") return error.message;
  if (typeof error?.code === "string") return error.code;
  return "";
}

function parseUserInfoResponse(data: unknown): UserInfoResponse {
  const envelope = asRecord(data);
  if (!envelope) throw new Error("Invalid exchange-tammi response");
  const record = mergeResponseRecords(envelope);
  const authRecord = firstRecord(record.auth, record.authentication, record.tokenInfo);
  const tokenRecord = firstRecord(
    record.tokens,
    record.token,
    record.tokenInfo,
    authRecord?.tokens,
    authRecord?.token,
    authRecord,
  );
  const userRecord = firstRecord(
    record.user,
    record.userInfo,
    record.user_info,
    record.profile,
    envelope.user,
  );
  const accessToken = firstString(
    record.access_token,
    record.accessToken,
    record.token,
    record.jwt,
    record.jwtToken,
    tokenRecord?.access_token,
    tokenRecord?.accessToken,
    tokenRecord?.token,
    tokenRecord?.jwt,
    tokenRecord?.jwtToken,
  );
  const refreshToken = firstString(
    record.refresh_token,
    record.refreshToken,
    tokenRecord?.refresh_token,
    tokenRecord?.refreshToken,
  );
  const mqttToken = firstString(
    record.mqttToken,
    record.mqtt_token,
    tokenRecord?.mqttToken,
    tokenRecord?.mqtt_token,
  );
  const userPhone = firstString(
    userRecord?.phone,
    userRecord?.phoneNumber,
    userRecord?.phone_number,
    userRecord?.msisdn,
    userRecord?.mobile,
    userRecord?.mobileNumber,
    userRecord?.mobile_number,
    userRecord?.username,
  );
  const phoneNumber = firstString(
    record.phoneNumber,
    record.phone_number,
    record.phone,
    record.msisdn,
    record.mobile,
    record.mobileNumber,
    record.mobile_number,
    userPhone,
  );
  const cameraToken = firstString(
    record.cameraToken,
    record.camera_token,
    record.zyToken,
    record.zy_token,
    tokenRecord?.cameraToken,
    tokenRecord?.camera_token,
    tokenRecord?.zyToken,
    tokenRecord?.zy_token,
  );
  const expiresIn = firstNumber(
    record.expires_in,
    record.expiresIn,
    tokenRecord?.expires_in,
    tokenRecord?.expiresIn,
  );

  return {
    ...record,
    ...(firstString(record.username, userRecord?.username) ? {
      username: firstString(record.username, userRecord?.username),
    } : {}),
    ...(firstString(record.email, userRecord?.email) ? {
      email: firstString(record.email, userRecord?.email),
    } : {}),
    ...(firstString(record.fullName, record.full_name, userRecord?.fullName, userRecord?.full_name, userRecord?.name)
      ? { fullName: firstString(record.fullName, record.full_name, userRecord?.fullName, userRecord?.full_name, userRecord?.name) }
      : {}),
    ...(phoneNumber ? { phone: phoneNumber } : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(firstString(record.msisdn, userRecord?.msisdn) ? {
      msisdn: firstString(record.msisdn, userRecord?.msisdn),
    } : {}),
    ...(accessToken ? { access_token: accessToken } : {}),
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
    ...(cameraToken ? { zyToken: cameraToken } : {}),
    ...(mqttToken ? { mqttToken } : {}),
    ...(cameraToken ? { cameraToken } : {}),
    ...(userRecord
      ? {
          user: {
            ...userRecord,
            ...(userPhone ? { phone: userPhone, phoneNumber: userPhone } : {}),
            ...(firstString(userRecord.name, userRecord.fullName, userRecord.full_name)
              ? { name: firstString(userRecord.name, userRecord.fullName, userRecord.full_name) }
              : {}),
            ...(firstString(userRecord.msisdn) ? { msisdn: firstString(userRecord.msisdn) } : {}),
          },
        }
      : {}),
  };
}

export function getPhoneFromUserInfo(data: UserInfoResponse): string {
  const candidates = [
    data.phone,
    data.phoneNumber,
    data.msisdn,
    data.user?.phone,
    data.user?.phoneNumber,
    data.user?.msisdn,
    data.username,
  ];
  for (const value of candidates) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

export async function getUserInfoByAuthCode(authCode: string): Promise<UserInfoResponse> {
  const res = await fetch(getTammiExchangeUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ authCode }),
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {}

  clearLogs();
  addLog("[userinfo]", "response", jsonForUserInfoDebugLog(data));

  if (!res.ok) {
    const msg = pickErrorMessage(data) || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const envelope = asRecord(data);
  const exchangeError = pickErrorMessage(data);
  if (envelope?.error && exchangeError) {
    throw new Error(exchangeError);
  }

  const parsed = parseUserInfoResponse(data);
  addLog(
    "[userinfo]",
    "normalized",
    JSON.stringify({
      hasAccessToken: Boolean(parsed.access_token),
      accessTokenLength: parsed.access_token?.length ?? 0,
      hasRefreshToken: Boolean(parsed.refresh_token),
      refreshTokenLength: parsed.refresh_token?.length ?? 0,
      hasPhone: Boolean(getPhoneFromUserInfo(parsed)),
      hasMqttToken: Boolean(parsed.mqttToken),
      hasCameraToken: Boolean(parsed.cameraToken),
    }),
  );
  return parsed;
}

