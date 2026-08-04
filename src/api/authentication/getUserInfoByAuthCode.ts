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
  const record = asRecord(envelope.data) ?? envelope;
  const userRecord = asRecord(record.user);
  const userPhone =
    typeof userRecord?.phone === "string"
      ? userRecord.phone
      : typeof userRecord?.phoneNumber === "string"
        ? userRecord.phoneNumber
        : "";
  const phoneNumber =
    typeof record.phoneNumber === "string"
      ? record.phoneNumber
      : typeof record.phone === "string"
        ? record.phone
        : userPhone;
  const cameraToken =
    typeof record.cameraToken === "string"
      ? record.cameraToken
      : typeof record.zyToken === "string"
        ? record.zyToken
        : "";

  return {
    ...record,
    ...(typeof record.username === "string" ? { username: record.username } : {}),
    ...(typeof record.email === "string" ? { email: record.email } : {}),
    ...(typeof record.fullName === "string"
      ? { fullName: record.fullName }
      : typeof userRecord?.name === "string"
        ? { fullName: userRecord.name }
        : {}),
    ...(typeof record.phone === "string"
      ? { phone: record.phone }
      : userPhone
        ? { phone: userPhone }
        : {}),
    ...(phoneNumber ? { phoneNumber } : {}),
    ...(typeof record.msisdn === "string" ? { msisdn: record.msisdn } : {}),
    ...(typeof record.access_token === "string" ? { access_token: record.access_token } : {}),
    ...(typeof record.refresh_token === "string" ? { refresh_token: record.refresh_token } : {}),
    ...(typeof record.expires_in === "number" ? { expires_in: record.expires_in } : {}),
    ...(typeof record.zyToken === "string" ? { zyToken: record.zyToken } : {}),
    ...(typeof record.mqttToken === "string" ? { mqttToken: record.mqttToken } : {}),
    ...(cameraToken ? { cameraToken } : {}),
    ...(userRecord
      ? {
          user: {
            ...userRecord,
            ...(typeof userRecord.phone === "string" ? { phone: userRecord.phone } : {}),
            ...(typeof userRecord.name === "string" ? { name: userRecord.name } : {}),
            ...(typeof userRecord.phoneNumber === "string" ? { phoneNumber: userRecord.phoneNumber } : {}),
            ...(typeof userRecord.msisdn === "string" ? { msisdn: userRecord.msisdn } : {}),
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

  return parseUserInfoResponse(data);
}

