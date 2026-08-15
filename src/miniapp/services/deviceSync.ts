import {
  getNewgenDeviceAttributeValuesUrl,
  getNewgenDeviceClientScopeTelemetryUrl,
  getNewgenDeviceSharedScopeTelemetryUrl,
  getNewgenDeviceTimeseriesUrl,
  getNewgenWsJwt,
  SMART_BUILDING_BASE_URL,
} from "../lib/config";
import { addLog } from "../lib/debugLog";
import { getCachedLoginJwt, isJwtExpired, tbLogin } from "../lib/tbWebSocket/tbWsAuth";
import {
  createNewgenRoomDevice,
  fetchNewgenDeviceState,
  fetchNewgenUserDevices,
  hasNewgenPlatformSession,
  readNewgenStateValue,
  sendNewgenCapabilityCommand,
  type NewgenPlatformDevice,
} from "./newgenPlatform";


function getNewgenTelemetryReadHeaders(): Record<string, string> | null {
  const jwt = getNewgenWsJwt();
  if (jwt) {
    return {
      Accept: "application/json",
      "X-Authorization": `Bearer ${jwt}`,
    };
  }
  return null;
}

const JSON_POST_HEADERS_BASE = {
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;


async function getNewgenSharedScopeWriteHeaders(): Promise<Record<string, string> | null> {
  const jwt = getNewgenWsJwt();
  if (jwt && !isJwtExpired(jwt)) {
    return { ...JSON_POST_HEADERS_BASE, "X-Authorization": `Bearer ${jwt}` };
  }
  const cachedJwt = getCachedLoginJwt();
  if (cachedJwt && !isJwtExpired(cachedJwt)) {
    return { ...JSON_POST_HEADERS_BASE, "X-Authorization": `Bearer ${cachedJwt}` };
  }
  const freshJwt = await tbLogin().catch(() => null);
  if (freshJwt && !isJwtExpired(freshJwt)) {
    return { ...JSON_POST_HEADERS_BASE, "X-Authorization": `Bearer ${freshJwt}` };
  }
  return null;
}

export interface TbEntityId {
  id: string;
  entityType: string;
}

export interface TbDevice {
  id: TbEntityId;
  createdTime?: number;
  tenantId?: TbEntityId;
  customerId?: TbEntityId;
  name?: string;
  type?: string;
  label?: string;
  deviceProfileId?: TbEntityId;
  firmwareId?: TbEntityId;
  softwareId?: TbEntityId;
  version?: number;
  additionalInfo?: Record<string, unknown>;
  deviceData?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SmartBuildingDeviceRecord {
  createdTime?: number;
  device?: TbDevice;
  deviceEntityType?: string;
  deviceId?: string;
  deviceType?: string;
  label?: string;
  name?: string;
  storedAt?: string;
  username?: string;
  fenceChannel?: 1 | 2;
  platformDeviceId?: string;
  externalDeviceId?: string;
  roomId?: string;
  provider?: string;
  model?: string;
  [key: string]: unknown;
}

function platformDeviceToSmartBuilding(device: NewgenPlatformDevice): SmartBuildingDeviceRecord {
  const label = String(device.raw.label ?? device.name ?? "").trim();
  return {
    deviceId: device.id,
    platformDeviceId: device.id,
    externalDeviceId: device.externalId ?? device.uid,
    deviceType: device.type,
    name: device.name,
    label,
    roomId: device.roomId,
    provider: device.provider,
    model: device.model,
    online: device.online,
    status: device.status,
    device: {
      id: { id: device.id, entityType: "DEVICE" },
      name: device.name,
      type: device.type,
      label,
      additionalInfo: {
        platformDeviceId: device.id,
        externalDeviceId: device.externalId,
        uid: device.uid,
        provider: device.provider,
        model: device.model,
        roomId: device.roomId,
      },
    },
    newgen: device.raw,
  };
}

function parseBooleanState(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["on", "true", "1", "open", "opened", "alarm", "detected", "active"].includes(normalized)) return true;
  if (["off", "false", "0", "close", "closed", "safe", "normal", "inactive"].includes(normalized)) return false;
  return undefined;
}

async function fetchPlatformBoolean(deviceId: string, keys: string[]): Promise<boolean | null> {
  if (!hasNewgenPlatformSession()) return null;
  const state = await fetchNewgenDeviceState(deviceId);
  return parseBooleanState(readNewgenStateValue(state, keys)) ?? null;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function readMessage(data: unknown): string {
  const record = asRecord(data);
  if (!record) return "";
  if (typeof record.detail === "string") return record.detail;
  if (typeof record.message === "string") return record.message;
  return "";
}

function parseSmartBuildingDeviceRecord(data: unknown): SmartBuildingDeviceRecord | null {
  const record = asRecord(data);
  if (!record) return null;
  return record as SmartBuildingDeviceRecord;
}

export async function createDeviceInNewGen(body: Record<string, unknown>): Promise<TbDevice> {
  void body;
  throw new Error("Legacy device creation is disabled; sign in to use NewGen Devices API");
}

export async function saveDeviceToSmartBuilding(username: string, device: TbDevice): Promise<SmartBuildingDeviceRecord> {
  const res = await fetch(`${SMART_BUILDING_BASE_URL}/devices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, device }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(readMessage(data) || `Save device HTTP ${res.status}`);
  }
  const parsed = parseSmartBuildingDeviceRecord(data);
  if (!parsed) throw new Error("Invalid SmartBuilding save response");
  return parsed;
}


export const NEWGEN_SAMPLE_PAGE_SIZE = 5;

export interface NewgenCustomerDevicesPageResult {
  devices: SmartBuildingDeviceRecord[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalElements: number;
  hasNext: boolean;
}


export async function fetchNewgenCustomerDevices(
  customerId: string,
  opts: { pageSize?: number; page?: number } = {},
): Promise<NewgenCustomerDevicesPageResult> {
  void customerId;
  void opts;
  throw new Error("Legacy sample-device API is disabled");
}


export async function fetchNewgenCustomerSampleDevices(page = 0): Promise<NewgenCustomerDevicesPageResult> {
  void page;
  throw new Error("Legacy sample-device API is disabled");
}

const ENV_DEVICE_ID_LIST_CACHE = new Map<string, string[]>();

function parseEnvDeviceIdList(envKey: string): string[] {
  if (!ENV_DEVICE_ID_LIST_CACHE.has(envKey)) {
    const raw =
      typeof import.meta !== "undefined"
        ? (import.meta.env as Record<string, unknown>)[envKey]
        : "";
    ENV_DEVICE_ID_LIST_CACHE.set(
      envKey,
      String(raw ?? "")
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return ENV_DEVICE_ID_LIST_CACHE.get(envKey)!;
}


export function isSmartSwitchTelemetryDevice(d: SmartBuildingDeviceRecord): boolean {
  const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
  const gatewayIds = parseEnvDeviceIdList("VITE_NEWGEN_GATEWAY_SOCKET_DEVICE_IDS");
  if (id && gatewayIds.length > 0 && gatewayIds.includes(id)) return false;

  const envIds = parseEnvDeviceIdList("VITE_NEWGEN_SMART_SWITCH_DEVICE_IDS");
  if (id && envIds.length > 0 && envIds.includes(id)) return true;

  const n = String(d.label ?? d.name ?? d.device?.label ?? d.device?.name ?? "").toLowerCase();
  const t = String(d.deviceType ?? d.device?.type ?? "").toLowerCase();
  const merged = `${n} ${t}`;
  // Aqara plug/socket phải đi nhánh cmd-socket (gateway socket), không phải smart switch 4 kênh.
  if (
    /smart\s*plug|wall\s*socket|aqara\s*smart\s*plug\s*socket|ổ\s*cắm|o\s*cam|ổ\s*điện|o\s*dien|cmd-socket/.test(
      merged,
    )
  ) {
    return false;
  }
  return (
    merged.includes("switch") ||
    merged.includes("smart_switch") ||
    merged.includes("công tắc") ||
    merged.includes("cong tac") ||
    /\bsw[1-4]\b/.test(merged) ||
    /\b(4ch|4-channel|4 channel|4 gang|4gang)\b/.test(merged)
  );
}


export function isGatewaySocketTelemetryDevice(d: SmartBuildingDeviceRecord): boolean {
  const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
  const envIds = parseEnvDeviceIdList("VITE_NEWGEN_GATEWAY_SOCKET_DEVICE_IDS");
  if (id && envIds.length > 0 && envIds.includes(id)) return true;

  const t = [
    d.label,
    d.name,
    d.device?.label,
    d.device?.name,
    d.deviceType,
    d.device?.type,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  if (
    /\b(gateway|hub|bridge|coordinator|zigbee|mqtt broker|điều khiển trung tâm)\b/.test(t)
  ) {
    return true;
  }
  if (/^home assistant$/i.test(String(d.label ?? d.device?.label ?? "").trim())) {
    return true;
  }
  if (
    /hành\s*lang|hanh\s*lang|hallway|hall\s+plug|đèn\s+hành|den\s+hanh/.test(t) ||
    /ổ\s*cắm|o\s*cam|smart\s*plug|wall\s*socket|ổ\s*điện|o\s*dien/.test(t)
  ) {
    return true;
  }
  if (
    (/chiếu\s*sáng|chieu\s+sang/.test(t) || /đèn\s+chiếu|den\s+chieu/.test(t)) &&
    /hành\s*lang|hanh\s*lang|hallway/.test(t)
  ) {
    return true;
  }
  return false;
}


export function isLedStripTelemetryDevice(d: SmartBuildingDeviceRecord): boolean {
  if (isSmartSwitchTelemetryDevice(d)) return false;
  const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
  const envIds = parseEnvDeviceIdList("VITE_NEWGEN_LED_STRIP_DEVICE_IDS");
  if (id && envIds.length > 0 && envIds.includes(id)) return true;

  const t = [
    d.label,
    d.name,
    d.device?.label,
    d.device?.name,
    d.deviceType,
    d.device?.type,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  return (
    /led\s*strip|strip\s*led|dải\s*led|dai\s*led|rgb\s*strip|đèn\s*dải|den\s*dai|dây\s*led|day\s*led/.test(t) ||
    (/color[\s-]*temp|nhiệt\s*độ\s*màu|nhiet\s*do\s*mau/.test(t) && /\bled\b|đèn|den/.test(t))
  );
}


export function isSmokeSensorTelemetryDevice(d: SmartBuildingDeviceRecord): boolean {
  const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
  const envIds = parseEnvDeviceIdList("VITE_NEWGEN_SMOKE_SENSOR_DEVICE_IDS");
  if (id && envIds.length > 0 && envIds.includes(id)) return true;

  const t = [
    d.label,
    d.name,
    d.device?.label,
    d.device?.name,
    d.deviceType,
    d.device?.type,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  return /\bsmoke\b|\bkhói\b|\bkhoi\b|cảm biến khói|cam bien khoi|smoke sensor|báo khói|bao khoi/.test(t);
}


export function isHumanSensorTelemetryDevice(d: SmartBuildingDeviceRecord): boolean {
  const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
  const envIds = parseEnvDeviceIdList("VITE_NEWGEN_HUMAN_SENSOR_DEVICE_IDS");
  if (id && envIds.length > 0 && envIds.includes(id)) return true;

  const t = [
    d.label,
    d.name,
    d.device?.label,
    d.device?.name,
    d.deviceType,
    d.device?.type,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  return /\bhuman\b|\bpir\b|\bpresence\b|\bngười\b|\bperson\b|human sensor|cảm biến người|cam bien nguoi/.test(t);
}

export function isDoorSensorTelemetryDevice(d: SmartBuildingDeviceRecord): boolean {
  const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
  const envIds = parseEnvDeviceIdList("VITE_NEWGEN_DOOR_SENSOR_DEVICE_IDS");
  if (id && envIds.length > 0 && envIds.includes(id)) return true;

  const t = [
    d.label,
    d.name,
    d.device?.label,
    d.device?.name,
    d.deviceType,
    d.device?.type,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  return /\bdoor\b|\bcửa\b|\bcua\b|door sensor|cảm biến cửa|cam bien cua|contact sensor/.test(t);
}

export function isFenceSensorTelemetryDevice(d: SmartBuildingDeviceRecord): boolean {
  const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
  const envIds = [
    ...parseEnvDeviceIdList("VITE_NEWGEN_FENCE1_SENSOR_DEVICE_IDS"),
    ...parseEnvDeviceIdList("VITE_NEWGEN_FENCE2_SENSOR_DEVICE_IDS"),
    ...parseEnvDeviceIdList("VITE_NEWGEN_FENCE_SENSOR_DEVICE_IDS"),
  ];
  if (id && envIds.length > 0 && envIds.includes(id)) return true;

  const t = [
    d.label,
    d.name,
    d.device?.label,
    d.device?.name,
    d.deviceType,
    d.device?.type,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  return /\bfence\b|\bhàng rào\b|\bhang rao\b|fence sensor|perimeter|hàng\s*rào\s*điện|electric fence/.test(t);
}


export function isSirenTelemetryDevice(d: SmartBuildingDeviceRecord): boolean {
  const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
  const envIds = parseEnvDeviceIdList("VITE_NEWGEN_SIREN_DEVICE_IDS");
  if (id && envIds.length > 0 && envIds.includes(id)) return true;

  const t = [
    d.label,
    d.name,
    d.device?.label,
    d.device?.name,
    d.deviceType,
    d.device?.type,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");
  if (String(d.deviceType ?? "").toLowerCase() === "siren") return true;
  return /\bsiren\b|còi báo|coi bao/.test(t);
}


export async function postDeviceSirenAttributes(
  deviceId: string,
  body: Record<string, string | number>,
): Promise<void> {
  if (hasNewgenPlatformSession()) {
    for (const [rawKey, rawValue] of Object.entries(body)) {
      const key = rawKey.startsWith("cmd_") ? rawKey : `cmd_${rawKey}`;
      const candidates = [key, rawKey, key.replace(/^cmd_/, "")];
      await sendNewgenCapabilityCommand(deviceId, candidates, rawValue);
    }
    return;
  }
  const headers = await getNewgenSharedScopeWriteHeaders();
  if (!headers) {
    throw new Error("Chưa có phiên đăng nhập NewGen để điều khiển siren.");
  }
  const id = deviceId.trim();
  if (!id) return;

  const payload: Record<string, string | number> = {};
  for (const [k, raw] of Object.entries(body)) {
    const key = String(k).trim();
    if (!key) continue;
    if (key === "siren_tune" || key === "cmd_siren_tune") {
      payload.cmd_siren_tune = Number(raw);
      continue;
    }
    if (key === "siren_duration_sec" || key === "cmd_siren_duration_sec") {
      payload.cmd_siren_duration_sec = Number(raw);
      continue;
    }
    if (key === "siren_volume" || key === "cmd_siren_volume") {
      payload.cmd_siren_volume = Number(raw);
      continue;
    }
    if (key === "siren_state" || key === "cmd_siren_state") {
      const state = String(raw).trim().toLowerCase();
      payload.cmd_siren_state = state === "on" ? "on" : "off";
      continue;
    }
    payload[key] = typeof raw === "number" ? raw : String(raw);
  }

  if (Object.keys(payload).length === 0) return;

  const url = getNewgenDeviceSharedScopeTelemetryUrl(id);
  addLog("[http_cmd]", id, JSON.stringify(payload));
  addLog("[http_cmd_req]", "POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  addLog("[http_cmd_res]", id, res.status, res.ok ? "ok" : (readMessage(data) || "failed"));
  if (!res.ok) {
    const msg = readMessage(data) || `HTTP ${res.status}`;
    throw new Error(msg || "Siren attribute POST failed");
  }
}

export interface DeviceSirenState {
  on?: boolean;
  tune?: number;
  volume?: number;
  durationSec?: number;
  levelRaw?: number;
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function fetchDeviceSirenStates(deviceId: string): Promise<DeviceSirenState | null> {
  if (!hasNewgenPlatformSession()) return null;
  try {
    const state = await fetchNewgenDeviceState(deviceId);
    const result: DeviceSirenState = {
      on: parseBooleanState(readNewgenStateValue(state, ["siren_state", "cmd_siren_state", "siren", "alarm"])),
      tune: parseFiniteNumber(readNewgenStateValue(state, ["siren_tune", "cmd_siren_tune", "tune"])),
      volume: parseFiniteNumber(readNewgenStateValue(state, ["siren_volume", "cmd_siren_volume", "volume"])),
      durationSec: parseFiniteNumber(readNewgenStateValue(state, [
        "siren_duration_sec",
        "cmd_siren_duration_sec",
        "duration_sec",
        "duration",
      ])),
      levelRaw: parseFiniteNumber(readNewgenStateValue(state, ["siren_level_raw", "level_raw", "level"])),
    };
    return Object.values(result).every((value) => value === undefined) ? null : result;
  } catch {
    return null;
  }
}


export const SMOKE_DETECTED_TELEMETRY_KEY = "smoke_sensor";


export const SMOKE_DETECTED_TELEMETRY_KEY_ALT = "smokeDetected";


export const HUMAN_SENSOR_TELEMETRY_KEY = "human_sensor";


export const HUMAN_SENSOR_TELEMETRY_KEY_ALT = "humanDetected";

export const DOOR_SENSOR_TELEMETRY_KEY = "door_sensor";

export const DOOR_SENSOR_TELEMETRY_KEY_ALT = "doorSensor";
export const FENCE1_SENSOR_TELEMETRY_KEY = "channel_1_status";
export const FENCE2_SENSOR_TELEMETRY_KEY = "channel_2_status";



export function parseSmokeDetectedValue(data: unknown): boolean {
  if (data === true || data === 1) return true;
  if (data === false || data === 0) return false;
  if (typeof data === "string") {
    const v = data.toLowerCase().trim();
    if (v === "cleared" || v === "clear" || v === "normal" || v === "off" || v === "false" || v === "0") {
      return false;
    }
    return (
      v === "detected" ||
      v === "alarm" ||
      v === "fire" ||
      v === "on" ||
      v === "true" ||
      v === "1" ||
      v === "smoke"
    );
  }
  return false;
}

function latestTimeseriesValue(
  payload: unknown,
  key: string,
): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const root = payload as Record<string, unknown>;
  let series: unknown = root[key];
  if (series === undefined && root.data !== null && typeof root.data === "object") {
    series = (root.data as Record<string, unknown>)[key];
  }
  if (!Array.isArray(series) || series.length === 0) return undefined;

  const first = series[0];
  if (Array.isArray(first) && first.length >= 2 && typeof first[0] === "number") {
    const rows = series.filter(
      (p): p is [number, unknown] =>
        Array.isArray(p) && p.length >= 2 && typeof p[0] === "number",
    );
    if (rows.length === 0) return undefined;
    rows.sort((a, b) => b[0] - a[0]);
    return rows[0][1];
  }

  const points = series.filter(
    (p): p is { ts?: number; value?: unknown } =>
      p !== null && typeof p === "object" && !Array.isArray(p) && "value" in p,
  );
  if (points.length === 0) return undefined;
  points.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  return points[0].value;
}


export async function fetchDeviceSmokeDetectedLatest(deviceId: string): Promise<boolean | null> {
  if (hasNewgenPlatformSession()) {
    try {
      return await fetchPlatformBoolean(deviceId, [
        SMOKE_DETECTED_TELEMETRY_KEY,
        SMOKE_DETECTED_TELEMETRY_KEY_ALT,
        "smoke",
        "alarm",
      ]);
    } catch {
      return null;
    }
  }
  const headers = getNewgenTelemetryReadHeaders();
  if (!headers) return null;
  const endTs = Date.now();
  const startTs = endTs - 90 * 24 * 60 * 60 * 1000;
  const url = getNewgenDeviceTimeseriesUrl(
    deviceId,
    [SMOKE_DETECTED_TELEMETRY_KEY, SMOKE_DETECTED_TELEMETRY_KEY_ALT],
    {
      startTs,
      endTs,
      limit: 500,
    },
  );
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    let raw = latestTimeseriesValue(data, SMOKE_DETECTED_TELEMETRY_KEY);
    if (raw === undefined || raw === null) {
      raw = latestTimeseriesValue(data, SMOKE_DETECTED_TELEMETRY_KEY_ALT);
    }
    if (raw === undefined || raw === null) return null;
    return parseSmokeDetectedValue(raw);
  } catch {
    return null;
  }
}


export async function fetchDeviceHumanSensorLatest(deviceId: string): Promise<boolean | null> {
  if (hasNewgenPlatformSession()) {
    try {
      return await fetchPlatformBoolean(deviceId, [
        HUMAN_SENSOR_TELEMETRY_KEY,
        HUMAN_SENSOR_TELEMETRY_KEY_ALT,
        "presence",
        "occupancy",
        "motion",
      ]);
    } catch {
      return null;
    }
  }
  const headers = getNewgenTelemetryReadHeaders();
  if (!headers) return null;
  const endTs = Date.now();
  const startTs = endTs - 90 * 24 * 60 * 60 * 1000;
  const url = getNewgenDeviceTimeseriesUrl(deviceId, [HUMAN_SENSOR_TELEMETRY_KEY, HUMAN_SENSOR_TELEMETRY_KEY_ALT], {
    startTs,
    endTs,
    limit: 500,
  });
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    let raw = latestTimeseriesValue(data, HUMAN_SENSOR_TELEMETRY_KEY);
    if (raw === undefined || raw === null) {
      raw = latestTimeseriesValue(data, HUMAN_SENSOR_TELEMETRY_KEY_ALT);
    }
    if (raw === undefined || raw === null) return null;
    return parseSmokeDetectedValue(raw);
  } catch {
    return null;
  }
}

function parseDoorSensorOpenValue(data: unknown): boolean | null {
  if (data === true || data === 1) return true;
  if (data === false || data === 0) return false;
  const v = String(data ?? "").toLowerCase().trim();
  if (!v) return null;
  if (["open", "opened", "unlock", "unlocked", "on", "true", "1"].includes(v)) return true;
  if (["closed", "close", "lock", "locked", "off", "false", "0"].includes(v)) return false;
  return null;
}

export async function fetchDeviceDoorSensorLatest(deviceId: string): Promise<boolean | null> {
  if (hasNewgenPlatformSession()) {
    try {
      return await fetchPlatformBoolean(deviceId, [
        DOOR_SENSOR_TELEMETRY_KEY,
        DOOR_SENSOR_TELEMETRY_KEY_ALT,
        "door",
        "open",
        "contact",
      ]);
    } catch {
      return null;
    }
  }
  const headers = getNewgenTelemetryReadHeaders();
  if (!headers) {
    addLog("[door_http]", deviceId, "no-headers");
    return null;
  }
  const endTs = Date.now();
  const startTs = endTs - 90 * 24 * 60 * 60 * 1000;
  const url = getNewgenDeviceTimeseriesUrl(deviceId, [DOOR_SENSOR_TELEMETRY_KEY, DOOR_SENSOR_TELEMETRY_KEY_ALT], {
    startTs,
    endTs,
    limit: 500,
  });
  try {
    addLog("[door_http]", deviceId, "fetch", url.slice(0, 120));
    const res = await fetch(url, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      addLog("[door_http]", deviceId, `http-${res.status}`);
      return null;
    }
    const data: unknown = await res.json().catch(() => null);
    addLog("[door_http]", deviceId, "resp", JSON.stringify(data).slice(0, 200));
    let raw = latestTimeseriesValue(data, DOOR_SENSOR_TELEMETRY_KEY);
    if (raw === undefined || raw === null) {
      raw = latestTimeseriesValue(data, DOOR_SENSOR_TELEMETRY_KEY_ALT);
    }
    if (raw === undefined || raw === null) {
      addLog("[door_http]", deviceId, "no-ts-value");
      return null;
    }
    const result = parseDoorSensorOpenValue(raw);
    addLog("[door_http]", deviceId, `parsed=${result}`);
    return result;
  } catch (e) {
    addLog("[door_http]", deviceId, "error", String(e));
    return null;
  }
}

function parseFenceSensorAlarmValue(data: unknown): boolean | null {
  if (data === true || data === 1) return true;
  if (data === false || data === 0) return false;
  const v = String(data ?? "").toLowerCase().trim();
  if (!v) return null;
  if (["alarm", "alert", "triggered", "on", "true", "1"].includes(v)) return true;
  if (["good", "normal", "ok", "off", "false", "0"].includes(v)) return false;
  return null;
}

export async function fetchDeviceFenceSensorLatest(deviceId: string, channel: 1 | 2 = 1): Promise<boolean | null> {
  if (hasNewgenPlatformSession()) {
    const key = channel === 2 ? FENCE2_SENSOR_TELEMETRY_KEY : FENCE1_SENSOR_TELEMETRY_KEY;
    try {
      return await fetchPlatformBoolean(deviceId, [key, `fence_${channel}`, `channel_${channel}`]);
    } catch {
      return null;
    }
  }
  const headers = getNewgenTelemetryReadHeaders();
  if (!headers) return null;
  const endTs = Date.now();
  const startTs = endTs - 90 * 24 * 60 * 60 * 1000;
  const key = channel === 2 ? FENCE2_SENSOR_TELEMETRY_KEY : FENCE1_SENSOR_TELEMETRY_KEY;
  const url = getNewgenDeviceTimeseriesUrl(deviceId, [key], {
    startTs,
    endTs,
    limit: 500,
  });
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    const raw = latestTimeseriesValue(data, key);
    if (raw === undefined || raw === null) return null;
    return parseFenceSensorAlarmValue(raw);
  } catch {
    return null;
  }
}

const SHARED_SCOPE_CMD_KEYS = ["cmd-sw1", "cmd-sw2", "cmd-sw3", "cmd-sw4"] as const;


export const SMART_SWITCH_STATE_KEYS = ["state-sw1", "state-sw2", "state-sw3", "state-sw4"] as const;

export type SmartSwitchChannel = 1 | 2 | 3 | 4;


function parseSwitchOnOffAttr(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  const normalized = String(v).trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "t", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "f", "off", "no"].includes(normalized)) return false;
  return undefined;
}

function attributesResponseToMap(data: unknown): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  if (Array.isArray(data)) {
    for (const row of data) {
      if (row && typeof row === "object" && "key" in row && "value" in row) {
        const r = row as { key: string; value: unknown };
        map[String(r.key)] = r.value;
      }
    }
  } else if (data && typeof data === "object") {
    Object.assign(map, data as Record<string, unknown>);
  }
  return map;
}


export async function fetchDeviceSwitchChannelStates(
  deviceId: string,
): Promise<[boolean, boolean, boolean, boolean] | null> {
  if (hasNewgenPlatformSession()) {
    try {
      const state = await fetchNewgenDeviceState(deviceId);
      const values = SMART_SWITCH_STATE_KEYS.map((key, index) => parseBooleanState(
        readNewgenStateValue(state, [key, SHARED_SCOPE_CMD_KEYS[index], `switch_${index + 1}`, `sw${index + 1}`]),
      ));
      if (values.every((value) => value === undefined)) return null;
      return [values[0] ?? false, values[1] ?? false, values[2] ?? false, values[3] ?? false];
    } catch {
      return null;
    }
  }
  const headers = getNewgenTelemetryReadHeaders();
  if (!headers) return null;
  const id = deviceId.trim();
  if (!id) return null;

  const acc: [
    boolean | undefined,
    boolean | undefined,
    boolean | undefined,
    boolean | undefined,
  ] = [undefined, undefined, undefined, undefined];

  const fillFromMap = (map: Record<string, unknown>, k0: string, k1: string, k2: string, k3: string) => {
    const t = [
      parseSwitchOnOffAttr(map[k0]),
      parseSwitchOnOffAttr(map[k1]),
      parseSwitchOnOffAttr(map[k2]),
      parseSwitchOnOffAttr(map[k3]),
    ] as const;
    for (let i = 0; i < 4; i++) {
      if (acc[i] === undefined && t[i] !== undefined) acc[i] = t[i];
    }
  };

  const pull = async (scope: "CLIENT_SCOPE" | "SHARED_SCOPE" | "SERVER_SCOPE", keys: readonly string[]) => {
    if (keys.length !== 4) return;
    const url = getNewgenDeviceAttributeValuesUrl(id, scope, [...keys]);
    try {
      const res = await fetch(url, { method: "GET", headers });
      if (!res.ok) return;
      const data: unknown = await res.json().catch(() => null);
      fillFromMap(attributesResponseToMap(data), keys[0], keys[1], keys[2], keys[3]);
    } catch {}
  };

  await pull("CLIENT_SCOPE", SMART_SWITCH_STATE_KEYS);
  await pull("SHARED_SCOPE", SHARED_SCOPE_CMD_KEYS);
  await pull("SERVER_SCOPE", SMART_SWITCH_STATE_KEYS);

  if (acc.every((x) => x === undefined)) return null;

  return [acc[0] ?? false, acc[1] ?? false, acc[2] ?? false, acc[3] ?? false];
}


export const GATEWAY_PLUG_STATE_KEY = "state-plug";


const GATEWAY_PLUG_CMD_SOCKET_KEY = "cmd-socket";


export async function fetchDeviceGatewayPlugState(deviceId: string): Promise<boolean | null> {
  if (hasNewgenPlatformSession()) {
    try {
      return await fetchPlatformBoolean(deviceId, [
        GATEWAY_PLUG_STATE_KEY,
        GATEWAY_PLUG_CMD_SOCKET_KEY,
        "socket",
        "power",
      ]);
    } catch {
      return null;
    }
  }
  const headers = getNewgenTelemetryReadHeaders();
  if (!headers) return null;
  const id = deviceId.trim();
  if (!id) return null;

  let resolved: boolean | undefined;

  const tryKeys = (map: Record<string, unknown>, keys: readonly string[]) => {
    for (const k of keys) {
      const p = parseSwitchOnOffAttr(map[k]);
      if (p !== undefined) {
        resolved = p;
        return;
      }
    }
  };

  const pull = async (scope: "CLIENT_SCOPE" | "SHARED_SCOPE" | "SERVER_SCOPE", keys: readonly string[]) => {
    if (resolved !== undefined) return;
    const url = getNewgenDeviceAttributeValuesUrl(id, scope, [...keys]);
    try {
      const res = await fetch(url, { method: "GET", headers });
      if (!res.ok) return;
      const data: unknown = await res.json().catch(() => null);
      tryKeys(attributesResponseToMap(data), keys);
    } catch {}
  };

  await pull("CLIENT_SCOPE", [GATEWAY_PLUG_STATE_KEY]);
  await pull("SHARED_SCOPE", [GATEWAY_PLUG_STATE_KEY, GATEWAY_PLUG_CMD_SOCKET_KEY]);
  await pull("SERVER_SCOPE", [GATEWAY_PLUG_STATE_KEY]);

  if (resolved === undefined) return null;
  return resolved;
}


export const LED_STATE_LIGHT_ATTR_KEY = "state-light";
export const LED_COLOR_TEMP_ATTR_KEY = "color-temp-light";
const LED_CMD_LIGHT_KEY = "cmd-light";
const LED_CMD_COLOR_TEMP_KEY = "cmd-color-temp-light";

function parseLedLightAttr(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  if (["0", "false", "f", "off", "no"].includes(s)) return false;
  if (["1", "true", "t", "on", "yes"].includes(s)) return true;
  return undefined;
}

function parseLedColorTempAttr(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}


export async function fetchDeviceLedStripStates(
  deviceId: string,
): Promise<{ lightOn: boolean; colorTemp: number } | null> {
  if (hasNewgenPlatformSession()) {
    try {
      const state = await fetchNewgenDeviceState(deviceId);
      const light = parseLedLightAttr(readNewgenStateValue(state, [
        LED_STATE_LIGHT_ATTR_KEY,
        LED_CMD_LIGHT_KEY,
        "light",
        "power",
      ]));
      const temp = parseLedColorTempAttr(readNewgenStateValue(state, [
        LED_COLOR_TEMP_ATTR_KEY,
        LED_CMD_COLOR_TEMP_KEY,
        "color_temperature",
        "color_temp",
      ]));
      if (light === undefined && temp === undefined) return null;
      return { lightOn: light ?? false, colorTemp: temp ?? 50 };
    } catch {
      return null;
    }
  }
  const headers = getNewgenTelemetryReadHeaders();
  if (!headers) return null;
  const id = deviceId.trim();
  if (!id) return null;

  let light: boolean | undefined;
  let temp: number | undefined;

  const fillFromMap = (map: Record<string, unknown>) => {
    if (light === undefined) {
      light =
        parseLedLightAttr(map[LED_STATE_LIGHT_ATTR_KEY]) ??
        parseLedLightAttr(map[LED_CMD_LIGHT_KEY]);
    }
    if (temp === undefined) {
      temp =
        parseLedColorTempAttr(map[LED_COLOR_TEMP_ATTR_KEY]) ??
        parseLedColorTempAttr(map[LED_CMD_COLOR_TEMP_KEY]);
    }
  };

  const pull = async (scope: "CLIENT_SCOPE" | "SHARED_SCOPE" | "SERVER_SCOPE", keys: readonly string[]) => {
    const url = getNewgenDeviceAttributeValuesUrl(id, scope, [...keys]);
    try {
      const res = await fetch(url, { method: "GET", headers });
      if (!res.ok) return;
      const data: unknown = await res.json().catch(() => null);
      fillFromMap(attributesResponseToMap(data));
    } catch {}
  };

  await pull("CLIENT_SCOPE", [LED_STATE_LIGHT_ATTR_KEY, LED_COLOR_TEMP_ATTR_KEY]);
  await pull("SHARED_SCOPE", [
    LED_STATE_LIGHT_ATTR_KEY,
    LED_COLOR_TEMP_ATTR_KEY,
    LED_CMD_LIGHT_KEY,
    LED_CMD_COLOR_TEMP_KEY,
  ]);
  await pull("SERVER_SCOPE", [LED_STATE_LIGHT_ATTR_KEY, LED_COLOR_TEMP_ATTR_KEY]);

  if (light === undefined && temp === undefined) return null;
  return { lightOn: light ?? false, colorTemp: temp ?? 50 };
}


export async function postDeviceSharedScopePower(deviceId: string, powerOn: boolean): Promise<void> {
  if (hasNewgenPlatformSession()) {
    await sendNewgenCapabilityCommand(deviceId, ["power", "switch", "on_off", "cmd-power"], powerOn ? "on" : "off");
    return;
  }
  const headers = await getNewgenSharedScopeWriteHeaders();
  if (!headers) {
    throw new Error("Chưa có phiên đăng nhập NewGen để điều khiển thiết bị.");
  }
  const url = getNewgenDeviceSharedScopeTelemetryUrl(deviceId);
  const body = { power: powerOn ? "on" : "off" };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(readMessage(data) || `Telemetry SHARED_SCOPE HTTP ${res.status}`);
  }
}


export async function postDeviceSharedScopeSwitchChannel(
  deviceId: string,
  channel: SmartSwitchChannel,
  on: boolean,
): Promise<void> {
  if (hasNewgenPlatformSession()) {
    const key = SHARED_SCOPE_CMD_KEYS[channel - 1];
    await sendNewgenCapabilityCommand(
      deviceId,
      [key, `switch_${channel}`, `switch${channel}`, `sw${channel}`],
      on ? "on" : "off",
    );
    return;
  }
  const headers = await getNewgenSharedScopeWriteHeaders();
  if (!headers) {
    throw new Error("Chưa có phiên đăng nhập NewGen để điều khiển thiết bị.");
  }
  const url = getNewgenDeviceSharedScopeTelemetryUrl(deviceId);
  const key = SHARED_SCOPE_CMD_KEYS[channel - 1];
  const body: Record<string, string> = { [key]: on ? "on" : "off" };
  addLog("[http_cmd]", deviceId, JSON.stringify(body));
  addLog("[http_cmd_req]", "POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  addLog("[http_cmd_res]", deviceId, res.status, res.ok ? "ok" : (readMessage(data) || "failed"));
  if (!res.ok) {
    throw new Error(readMessage(data) || `Telemetry SHARED_SCOPE HTTP ${res.status}`);
  }
}


export async function postDeviceClientScopeStatePlug(deviceId: string, on: boolean): Promise<void> {
  if (hasNewgenPlatformSession()) {
    await sendNewgenCapabilityCommand(
      deviceId,
      [GATEWAY_PLUG_CMD_SOCKET_KEY, "socket", "power", GATEWAY_PLUG_STATE_KEY],
      on ? "on" : "off",
    );
    return;
  }
  const headers = await getNewgenSharedScopeWriteHeaders();
  if (!headers) {
    throw new Error("Chưa có phiên đăng nhập NewGen để điều khiển đèn hành lang.");
  }
  const url = getNewgenDeviceClientScopeTelemetryUrl(deviceId);
  const body: Record<string, string> = { [GATEWAY_PLUG_STATE_KEY]: on ? "on" : "off" };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(readMessage(data) || `CLIENT_SCOPE state-plug HTTP ${res.status}`);
  }
}


export async function postDeviceSharedScopeSocketPower(deviceId: string, on: boolean): Promise<void> {
  if (hasNewgenPlatformSession()) {
    await sendNewgenCapabilityCommand(
      deviceId,
      [GATEWAY_PLUG_CMD_SOCKET_KEY, "socket", "power", GATEWAY_PLUG_STATE_KEY],
      on ? "on" : "off",
    );
    return;
  }
  const headers = await getNewgenSharedScopeWriteHeaders();
  if (!headers) {
    throw new Error("Chưa có phiên đăng nhập NewGen để điều khiển gateway / đèn hành lang.");
  }
  const url = getNewgenDeviceSharedScopeTelemetryUrl(deviceId);
  const body = { "cmd-socket": on ? "on" : "off" };
  addLog("[http_cmd]", deviceId, JSON.stringify(body));
  addLog("[http_cmd_req]", "POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  addLog("[http_cmd_res]", deviceId, res.status, res.ok ? "ok" : (readMessage(data) || "failed"));
  if (!res.ok) {
    throw new Error(readMessage(data) || `Telemetry SHARED_SCOPE HTTP ${res.status}`);
  }
}

export async function sendGatewayPlugHallwayControl(deviceId: string | null, on: boolean): Promise<void> {
  if (!deviceId?.trim()) return;
  const id = deviceId.trim();
  await postDeviceSharedScopeSocketPower(id, on);
  addLog("[hallway_plug]", id, on ? "on" : "off", "cmd-socket SHARED_SCOPE ok");
}


export async function postDeviceSharedScopeLedLight(deviceId: string, on: boolean): Promise<void> {
  if (hasNewgenPlatformSession()) {
    await sendNewgenCapabilityCommand(
      deviceId,
      [LED_CMD_LIGHT_KEY, "light", "power", LED_STATE_LIGHT_ATTR_KEY],
      on ? "on" : "off",
    );
    return;
  }
  const headers = await getNewgenSharedScopeWriteHeaders();
  if (!headers) {
    throw new Error("Chưa có phiên đăng nhập NewGen để điều khiển LED.");
  }
  const url = getNewgenDeviceSharedScopeTelemetryUrl(deviceId);
  const body = { "cmd-light": on ? "on" : "off" };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(readMessage(data) || `Telemetry SHARED_SCOPE cmd-light HTTP ${res.status}`);
  }
}


export async function postDeviceSharedScopeLedColorTemp(deviceId: string, value: number): Promise<void> {
  if (hasNewgenPlatformSession()) {
    const normalized = Math.max(0, Math.min(100, Math.round(Number(value))));
    await sendNewgenCapabilityCommand(
      deviceId,
      [LED_CMD_COLOR_TEMP_KEY, "color_temperature", "color_temp", LED_COLOR_TEMP_ATTR_KEY],
      normalized,
    );
    return;
  }
  const headers = await getNewgenSharedScopeWriteHeaders();
  if (!headers) {
    throw new Error("Chưa có phiên đăng nhập NewGen để điều khiển LED.");
  }
  const v = Math.max(0, Math.min(100, Math.round(Number(value))));
  const url = getNewgenDeviceSharedScopeTelemetryUrl(deviceId);
  const body = { "cmd-color-temp-light": v };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(readMessage(data) || `Telemetry SHARED_SCOPE cmd-color-temp-light HTTP ${res.status}`);
  }
}


async function fetchAllNewgenDevices(): Promise<SmartBuildingDeviceRecord[]> {
  return [];
}


export async function fetchSmartHomeDevicesFromNewgen(): Promise<SmartBuildingDeviceRecord[]> {
  const list = await fetchAllNewgenDevices();
  const seenIds = new Set(list.map((d) => String(d.deviceId ?? d.device?.id?.id ?? "").trim()).filter(Boolean));

  const fence1Ids = [
    ...parseEnvDeviceIdList("VITE_NEWGEN_FENCE1_SENSOR_DEVICE_IDS"),
    ...parseEnvDeviceIdList("VITE_NEWGEN_FENCE_SENSOR_DEVICE_IDS"),
  ].filter(Boolean);
  const fence2Ids = [
    ...parseEnvDeviceIdList("VITE_NEWGEN_FENCE2_SENSOR_DEVICE_IDS"),
    ...fence1Ids,
  ].filter(Boolean);

  for (const id of fence1Ids) {
    if (seenIds.has(id)) continue;
    list.push({
      deviceId: id,
      name: "Fence1",
      label: "Fence1",
      deviceType: "fence_sensor",
      fenceChannel: 1,
      device: {
        id: { id, entityType: "DEVICE" },
        name: "Fence1",
        label: "Fence1",
        type: "fence_sensor",
      },
    });
    seenIds.add(id);
  }

  for (const id of fence2Ids) {
    list.push({
      deviceId: id,
      name: "Fence2",
      label: "Fence2",
      deviceType: "fence_sensor",
      fenceChannel: 2,
      device: {
        id: { id, entityType: "DEVICE" },
        name: "Fence2",
        label: "Fence2",
        type: "fence_sensor",
      },
    });
  }

  return list;
}

export async function getDevicesByUsername(username: string): Promise<SmartBuildingDeviceRecord[]> {
  if (hasNewgenPlatformSession()) {
    const devices = await fetchNewgenUserDevices(true);
    return devices.map(platformDeviceToSmartBuilding);
  }
  const bust = `_=${Date.now()}`;
  const url = `${SMART_BUILDING_BASE_URL}/devices/by-username?username=${encodeURIComponent(username)}&${bust}`;

  const [campusResult, newgenDevices] = await Promise.allSettled([
    fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).then(async (res) => {
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(`Get devices HTTP ${res.status}`);
      if (!Array.isArray(data)) return [];
      return data
        .map((item) => parseSmartBuildingDeviceRecord(item))
        .filter((item): item is SmartBuildingDeviceRecord => item !== null);
    }),
    fetchAllNewgenDevices(),
  ]);

  const campusDevices = campusResult.status === "fulfilled" ? campusResult.value : [];

  const newgen = newgenDevices.status === "fulfilled" ? newgenDevices.value : [];

  const seenIds = new Set(campusDevices.map((d) => d.deviceId).filter(Boolean));
  const merged = [
    ...campusDevices,
    ...newgen.filter((d) => d.deviceId && !seenIds.has(d.deviceId)),
  ];

  return merged;
}

export async function createAndStoreDevice(
  username: string,
  newGenRequestBody: Record<string, unknown>,
): Promise<SmartBuildingDeviceRecord> {
  if (hasNewgenPlatformSession()) {
    const created = await createNewgenRoomDevice(newGenRequestBody);
    return platformDeviceToSmartBuilding(created);
  }
  const created = await createDeviceInNewGen(newGenRequestBody);
  return saveDeviceToSmartBuilding(username, created);
}

