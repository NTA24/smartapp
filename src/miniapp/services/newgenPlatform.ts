import { getNewgenAuthApiBase, getNewgenDevicesApiBase } from "../lib/config";
import { addLog } from "../lib/debugLog";

interface ApiEnvelope<T> {
  data?: T;
  error?: unknown;
}

export interface NewgenPlatformDevice {
  id: string;
  name?: string;
  type?: string;
  model?: string;
  status?: string;
  uid?: string;
  provider?: string;
  online?: boolean;
  externalId?: string;
  roomId?: string;
  apartmentId?: string;
  raw: Record<string, unknown>;
}

export interface NewgenPlatformRoom {
  id: string;
  name: string;
  apartmentId?: string;
  apartmentName?: string;
}

export interface NewgenDeviceState {
  online?: boolean;
  reported: Record<string, unknown>;
  desired: Record<string, unknown>;
  displayState: Record<string, unknown>;
  pending?: boolean;
  pendingKeys: string[];
  lastSeenAt?: string;
  lastReportedAt?: string;
  lastCommandAt?: string;
  raw: Record<string, unknown>;
}

export interface NewgenDeviceCapability {
  code: string;
  readable?: boolean;
  writable?: boolean;
  values?: string[];
  min?: number;
  max?: number;
  unit?: string;
  valueType?: string;
}

export interface NewgenDeviceCommandResponse {
  commandId?: string;
  status?: string;
  code?: string;
  value?: string;
  dispatchError?: string;
  raw: Record<string, unknown>;
}

export interface NewgenRealtimeMqttSession {
  protocol?: string;
  brokerUri?: string;
  clientId?: string;
  username?: string;
  token?: string;
  expiresInSeconds?: number;
  topics: string[];
  topicPermissions: Array<{ action?: string; topic?: string; qosMax?: number }>;
  raw: Record<string, unknown>;
}

type TokenRefreshListener = (tokens: { accessToken: string; refreshToken?: string }) => void;

let accessToken = "";
let refreshToken = "";
let zyToken = "";
let refreshInFlight: Promise<string | null> | null = null;
let onTokenRefresh: TokenRefreshListener | undefined;
const aliasToInternalId = new Map<string, string>();
const rooms: NewgenPlatformRoom[] = [];
const capabilityCache = new Map<string, NewgenDeviceCapability[]>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function requestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function readError(payload: unknown, status: number): string {
  const envelope = asRecord(payload);
  const error = asRecord(envelope?.error);
  return firstString(
    error?.message,
    error?.detail,
    error?.code,
    envelope?.message,
  ) || `NewGen HTTP ${status}`;
}

function unwrap<T>(payload: unknown): T {
  const envelope = asRecord(payload) as ApiEnvelope<T> | null;
  return (envelope && "data" in envelope ? envelope.data : payload) as T;
}

export function configureNewgenPlatformSession(
  nextAccessToken: string,
  nextRefreshToken = "",
  listener?: TokenRefreshListener,
): void {
  accessToken = nextAccessToken.trim();
  refreshToken = nextRefreshToken.trim();
  onTokenRefresh = listener;
}

export function hasNewgenPlatformSession(): boolean {
  return Boolean(accessToken);
}

export function configureNewgenPlatformZyToken(nextZyToken: string): void {
  zyToken = nextZyToken.trim();
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken) return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const response = await fetch(`${getNewgenAuthApiBase()}/token/refresh`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-Id": requestId(),
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      addLog("[newgen]", "refresh-failed", readError(payload, response.status));
      return null;
    }
    const data = asRecord(unwrap<unknown>(payload));
    const nextAccess = firstString(data?.access_token, data?.accessToken);
    const nextRefresh = firstString(data?.refresh_token, data?.refreshToken, refreshToken);
    if (!nextAccess) return null;
    accessToken = nextAccess;
    refreshToken = nextRefresh;
    onTokenRefresh?.({ accessToken: nextAccess, refreshToken: nextRefresh });
    return nextAccess;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function authorizedRequest<T>(
  url: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<T> {
  if (!accessToken) throw new Error("Chưa có NewGen access token");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("X-Request-Id", requestId());
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(url, { ...init, headers });
  if (allowRefresh && (response.status === 401 || response.status === 403)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return authorizedRequest<T>(url, init, false);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(readError(payload, response.status));
  return unwrap<T>(payload);
}

function rememberAlias(alias: unknown, internalId: string): void {
  const value = firstString(alias);
  if (value) aliasToInternalId.set(value, internalId);
}

function mapDevice(value: unknown, roomId?: string, apartmentId?: string): NewgenPlatformDevice | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = firstString(record.id, record.device_id, record.deviceId);
  if (!id) return null;
  const internalId = id;
  rememberAlias(internalId, internalId);
  rememberAlias(record.external_id, internalId);
  rememberAlias(record.externalId, internalId);
  rememberAlias(record.uid, internalId);
  rememberAlias(record.device_id, internalId);
  rememberAlias(record.deviceId, internalId);
  return {
    id: internalId,
    name: firstString(record.name) || undefined,
    type: firstString(record.type, record.category) || undefined,
    model: firstString(record.model) || undefined,
    status: firstString(record.status) || undefined,
    uid: firstString(record.uid, record.serial_number) || undefined,
    provider: firstString(record.provider, record.vendor) || undefined,
    online: typeof record.online === "boolean" ? record.online : undefined,
    externalId: firstString(record.external_id, record.externalId, record.device_external_id) || undefined,
    roomId: firstString(record.room_id, roomId) || undefined,
    apartmentId: firstString(record.apartment_id, apartmentId) || undefined,
    raw: record,
  };
}

export function resolveNewgenInternalDeviceId(deviceId: string): string {
  const value = deviceId.trim();
  return aliasToInternalId.get(value) ?? value;
}

export async function fetchNewgenUserDevices(includeState = true): Promise<NewgenPlatformDevice[]> {
  const query = new URLSearchParams({ include_state: String(includeState) });
  const inventory = await authorizedRequest<Record<string, unknown>>(
    `${getNewgenDevicesApiBase()}/devices?${query.toString()}`,
    { headers: zyToken ? { "X-ZY-Token": zyToken } : undefined },
  );
  const apartments = Array.isArray(inventory?.apartments) ? inventory.apartments : [];
  const devices: NewgenPlatformDevice[] = [];
  rooms.length = 0;

  for (const apartmentValue of apartments) {
    const apartment = asRecord(apartmentValue);
    if (!apartment) continue;
    const apartmentId = firstString(apartment.id);
    const apartmentName = firstString(apartment.name);
    const rooms = Array.isArray(apartment.rooms) ? apartment.rooms : [];
    for (const roomValue of rooms) {
      const room = asRecord(roomValue);
      if (!room) continue;
      const roomId = firstString(room.id);
      if (roomId && !rooms.some((item) => item.id === roomId)) {
        rooms.push({
          id: roomId,
          name: firstString(room.name) || `Room ${roomId}`,
          apartmentId: apartmentId || undefined,
          apartmentName: apartmentName || undefined,
        });
      }
      const items = Array.isArray(room.devices) ? room.devices : [];
      for (const item of items) {
        const mapped = mapDevice(item, roomId, apartmentId);
        if (mapped) devices.push(mapped);
      }
    }
  }

  return devices;
}

export async function fetchNewgenRooms(): Promise<NewgenPlatformRoom[]> {
  if (rooms.length === 0) await fetchNewgenUserDevices(false);
  return rooms.map((room) => ({ ...room }));
}

function normalizeState(value: unknown): NewgenDeviceState {
  const record = asRecord(value) ?? {};
  const reported = asRecord(record.reported) ?? {};
  const desired = asRecord(record.desired) ?? {};
  const displayState = asRecord(record.display_state) ?? asRecord(record.displayState) ?? {};
  return {
    online: typeof record.online === "boolean" ? record.online : undefined,
    reported,
    desired,
    displayState,
    pending: typeof record.pending === "boolean" ? record.pending : undefined,
    pendingKeys: Array.isArray(record.pending_keys)
      ? record.pending_keys.map((item) => firstString(item)).filter(Boolean)
      : [],
    lastSeenAt: firstString(record.last_seen_at) || undefined,
    lastReportedAt: firstString(record.last_reported_at) || undefined,
    lastCommandAt: firstString(record.last_command_at) || undefined,
    raw: record,
  };
}

export async function fetchNewgenDeviceState(deviceId: string): Promise<NewgenDeviceState> {
  const id = resolveNewgenInternalDeviceId(deviceId);
  const data = await authorizedRequest<unknown>(
    `${getNewgenDevicesApiBase()}/devices/${encodeURIComponent(id)}/state`,
  );
  return normalizeState(data);
}

export function readNewgenStateValue(state: NewgenDeviceState, keys: string[]): unknown {
  const sources = [state.displayState, state.reported, state.desired, state.raw];
  for (const key of keys) {
    for (const source of sources) {
      if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    }
  }
  return undefined;
}

export async function fetchNewgenDeviceCapabilities(
  deviceId: string,
): Promise<NewgenDeviceCapability[]> {
  const id = resolveNewgenInternalDeviceId(deviceId);
  const cached = capabilityCache.get(id);
  if (cached) return cached;
  const data = await authorizedRequest<Record<string, unknown>>(
    `${getNewgenDevicesApiBase()}/devices/${encodeURIComponent(id)}/capabilities`,
  );
  const rawCapabilities = Array.isArray(data?.capabilities) ? data.capabilities : [];
  const capabilities = rawCapabilities.flatMap((value): NewgenDeviceCapability[] => {
    const item = asRecord(value);
    const code = firstString(item?.code);
    if (!item || !code) return [];
    return [{
      code,
      readable: typeof item.readable === "boolean" ? item.readable : undefined,
      writable: typeof item.writable === "boolean" ? item.writable : undefined,
      values: Array.isArray(item.values) ? item.values.map((entry) => firstString(entry)).filter(Boolean) : undefined,
      min: typeof item.min === "number" ? item.min : undefined,
      max: typeof item.max === "number" ? item.max : undefined,
      unit: firstString(item.unit) || undefined,
      valueType: firstString(item.value_type, item.valueType) || undefined,
    }];
  });
  capabilityCache.set(id, capabilities);
  return capabilities;
}

function normalizeCommandResponse(value: unknown): NewgenDeviceCommandResponse {
  const record = asRecord(value) ?? {};
  return {
    commandId: firstString(record.command_id, record.commandId) || undefined,
    status: firstString(record.status) || undefined,
    code: firstString(record.code) || undefined,
    value: firstString(record.value) || undefined,
    dispatchError: firstString(record.dispatch_error, record.dispatchError) || undefined,
    raw: record,
  };
}

export async function sendNewgenDeviceCommand(
  deviceId: string,
  command: {
    code: string;
    value?: string | number | boolean;
    endpoint?: string;
    payload?: Record<string, unknown>;
    desired?: Record<string, unknown>;
  },
): Promise<NewgenDeviceCommandResponse> {
  const id = resolveNewgenInternalDeviceId(deviceId);
  const body = {
    code: command.code,
    ...(command.value !== undefined ? { value: String(command.value) } : {}),
    ...(command.endpoint ? { endpoint: command.endpoint } : {}),
    ...(command.payload ? { payload: command.payload } : {}),
    ...(command.desired ? { desired: command.desired } : {}),
  };
  const data = await authorizedRequest<unknown>(
    `${getNewgenDevicesApiBase()}/devices/${encodeURIComponent(id)}/commands`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return normalizeCommandResponse(data);
}

export async function sendNewgenCapabilityCommand(
  deviceId: string,
  candidateCodes: string[],
  value: string | number | boolean,
): Promise<NewgenDeviceCommandResponse> {
  let code = candidateCodes[0] ?? "power";
  try {
    const capabilities = await fetchNewgenDeviceCapabilities(deviceId);
    const candidates = new Set(candidateCodes.map((item) => item.toLowerCase()));
    const matched = capabilities.find(
      (item) => item.writable !== false && candidates.has(item.code.toLowerCase()),
    );
    if (matched) code = matched.code;
  } catch {
    // Capability metadata is optional; the backend may still accept the known command code.
  }
  return sendNewgenDeviceCommand(deviceId, { code, value });
}

export async function createNewgenRoomDevice(
  input: Record<string, unknown>,
): Promise<NewgenPlatformDevice> {
  if (rooms.length === 0) await fetchNewgenUserDevices(false);
  const explicitRoomId = firstString(input.room_id, input.roomId);
  const roomId = explicitRoomId || rooms[0]?.id || "";
  if (!roomId) throw new Error("Tài khoản chưa có room để thêm thiết bị");
  const body = {
    name: firstString(input.name),
    type: firstString(input.type),
    ...(firstString(input.model) ? { model: firstString(input.model) } : {}),
    ...(firstString(input.status) ? { status: firstString(input.status) } : {}),
    ...(firstString(input.uid) ? { uid: firstString(input.uid) } : {}),
    ...(typeof input.online === "boolean" ? { online: input.online } : {}),
  };
  const data = await authorizedRequest<unknown>(
    `${getNewgenDevicesApiBase()}/rooms/${encodeURIComponent(roomId)}/devices`,
    { method: "POST", body: JSON.stringify(body) },
  );
  const mapped = mapDevice(data, roomId);
  if (!mapped) throw new Error("NewGen trả về thiết bị không hợp lệ");
  return mapped;
}

export async function fetchNewgenRealtimeMqttSession(): Promise<NewgenRealtimeMqttSession> {
  const data = await authorizedRequest<Record<string, unknown>>(
    `${getNewgenAuthApiBase()}/realtime/mqtt/session`,
  );
  const permissions = Array.isArray(data?.topic_permissions) ? data.topic_permissions : [];
  return {
    protocol: firstString(data?.protocol) || undefined,
    brokerUri: firstString(data?.broker_uri, data?.brokerUri) || undefined,
    clientId: firstString(data?.client_id, data?.clientId) || undefined,
    username: firstString(data?.username) || undefined,
    token: firstString(data?.token) || undefined,
    expiresInSeconds: typeof data?.expires_in_seconds === "number" ? data.expires_in_seconds : undefined,
    topics: Array.isArray(data?.topics) ? data.topics.map((item) => firstString(item)).filter(Boolean) : [],
    topicPermissions: permissions.flatMap((value) => {
      const item = asRecord(value);
      if (!item) return [];
      return [{
        action: firstString(item.action) || undefined,
        topic: firstString(item.topic) || undefined,
        qosMax: typeof item.qos_max === "number" ? item.qos_max : undefined,
      }];
    }),
    raw: data,
  };
}
