import {
  getNewgenSampleDevicesApiKey,
  getNewgenWsJwt,
  getNewgenWsTelemetryUrl,
  getNewgenWsUseCmdsFormat,
} from "../config";
import { addLog } from "../debugLog";
import {
  getCachedLoginJwt,
  isJwtExpired,
  rejectCachedLoginJwt,
  tbLogin,
} from "./tbWsAuth";
import {
  entityIdsMatch,
  extractTbWsAttributeValueLikeDemo,
  flattenAttributeData,
  humanSensorValPreview,
  mapPresenceWsPayloadToAlarmState,
  mergeTbWsPayloadData,
  normalizeTelemetryPoints,
  readMsgEntityId,
  readMsgEntityIdDeep,
  SMART_SWITCH_LIKE_KEY_RE,
  unwrapTelemetryScalar,
} from "./tbWsParser";
import { parseSwitchBool, processAttrs } from "./tbWsSmartSwitch";
import {
  type BatchAttrCb,
  type SmartSwitchWsListener,
  type Sub,
  type TbWsMsg,
  type ValueCb,
  DOOR_TS_KEY,
  DOOR_TS_KEY_ALT,
  GATEWAY_PLUG_ATTR_KEY,
  HUMAN_TS_KEY,
  HUMAN_TS_KEY_ALT,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
} from "./tbWsModel";

function logHumanSensorWsLine(deviceId: string, raw: unknown): void {
  const id = deviceId.trim() || "?";
  const alarm = mapPresenceWsPayloadToAlarmState(raw);
  if (alarm === true) {
    addLog("[human_sensor]", id, "detected");
    return;
  }
  if (alarm === false) {
    addLog("[human_sensor]", id, "cleared");
    return;
  }
  addLog("[human_sensor]", id, "unparsed", humanSensorValPreview(raw));
}

function logGatewayPlugWsLine(deviceId: string, raw: unknown): void {
  const id = deviceId.trim() || "?";
  if (raw === undefined || raw === null) {
    addLog("[hallway_plug]", id, "unparsed", "null");
    return;
  }
  if (typeof raw === "boolean") {
    addLog("[hallway_plug]", id, raw ? "on" : "off");
    return;
  }
  const s = String(raw).toLowerCase().trim();
  if (s === "on" || s === "true" || s === "1") {
    addLog("[hallway_plug]", id, "on");
    return;
  }
  if (s === "off" || s === "false" || s === "0") {
    addLog("[hallway_plug]", id, "off");
    return;
  }
  addLog("[hallway_plug]", id, "unparsed", humanSensorValPreview(raw));
}

export class TbWsManager {
  private dispatchTelemetryValue(
    key: string,
    v: unknown,
    sidNum: number,
    entityIdFromMsg: string | undefined,
  ): void {
    const matches = [...this.subs.values()].filter((s) =>
      s.batchKeys ? s.batchKeys.includes(key) : s.key === key,
    );
    if (matches.length === 0) return;

    const notify = (sub: Sub) => {
      if (sub.batchAttrCb) sub.batchAttrCb(key, v);
      else sub.cb(v);
    };

    if (matches.length === 1) {
      notify(matches[0]);
      return;
    }

    if (SMART_SWITCH_LIKE_KEY_RE.test(key)) {
      const d0 = matches[0].deviceId;
      if (matches.every((s) => s.deviceId === d0)) {
        matches.forEach(notify);
        return;
      }
    }

    if (!Number.isNaN(sidNum)) {
      const bySid = matches.filter((s) => s.cmdId === sidNum);
      if (bySid.length > 0) {
        bySid.forEach(notify);
        return;
      }
    }

    if (entityIdFromMsg) {
      const byEntity = matches.filter(
        (s) => s.deviceId === entityIdFromMsg || entityIdsMatch(s.deviceId, entityIdFromMsg),
      );
      if (byEntity.length > 0) {
        byEntity.forEach(notify);
        return;
      }
    }

    const d0 = matches[0].deviceId;
    if (matches.every((s) => s.deviceId === d0)) {
      matches.forEach(notify);
      return;
    }

    notify(matches[0]);
  }

  private dispatchWsAttrKey(
    k: string,
    rawPts: unknown,
    sidNum: number,
    entityId: string | undefined,
  ): void {
    const rows = normalizeTelemetryPoints(rawPts);
    const isHumanKey = k === HUMAN_TS_KEY || k === HUMAN_TS_KEY_ALT;
    const isDoorKey = k === DOOR_TS_KEY || k === DOOR_TS_KEY_ALT;
    const isGatewayPlugKey = k === GATEWAY_PLUG_ATTR_KEY;

    let v: unknown;
    if (rows && rows.length > 0) {
      const sorted = [...rows].sort((a, b) => Number(b[0]) - Number(a[0]));
      let cell: unknown = sorted[0][1];
      if (Array.isArray(cell) && cell.length === 1) cell = cell[0];
      v = unwrapTelemetryScalar(cell);
    } else {
      const demoUnwrapped = extractTbWsAttributeValueLikeDemo(rawPts);
      const candidate =
        demoUnwrapped !== undefined && demoUnwrapped !== null ? demoUnwrapped : rawPts;
      const flat = unwrapTelemetryScalar(candidate);
      if (flat === undefined || flat === null) {
        if (isHumanKey) {
          const matches = [...this.subs.values()].filter((s) =>
            s.batchKeys ? s.batchKeys.includes(k) : s.key === k,
          );
          const dev = (entityId ?? matches[0]?.deviceId ?? "").trim();
          addLog("[human_sensor]", dev || "?", "empty-or-bad-shape", humanSensorValPreview(rawPts));
        }
        if (isGatewayPlugKey) {
          const matches = [...this.subs.values()].filter((s) =>
            s.batchKeys ? s.batchKeys.includes(k) : s.key === k,
          );
          const dev = (entityId ?? matches[0]?.deviceId ?? "").trim();
          addLog("[hallway_plug]", dev || "?", "empty-or-bad-shape", humanSensorValPreview(rawPts));
        }
        return;
      }
      v = flat;
    }

    if (isHumanKey) {
      const matches = [...this.subs.values()].filter((s) =>
        s.batchKeys ? s.batchKeys.includes(k) : s.key === k,
      );
      const dev = (entityId ?? matches[0]?.deviceId ?? "").trim();
      logHumanSensorWsLine(dev || "?", v);
    }
    if (isDoorKey) {
      const matches = [...this.subs.values()].filter((s) =>
        s.batchKeys ? s.batchKeys.includes(k) : s.key === k,
      );
      const dev = (entityId ?? matches[0]?.deviceId ?? "").trim();
      const state = String(v ?? "").toLowerCase().trim();
      addLog("[door_sensor]", dev || "?", state === "open" ? "open" : state === "closed" ? "closed" : `raw=${humanSensorValPreview(v)}`);
    }
    if (isGatewayPlugKey) {
      const matches = [...this.subs.values()].filter((s) =>
        s.batchKeys ? s.batchKeys.includes(k) : s.key === k,
      );
      const dev = (entityId ?? matches[0]?.deviceId ?? "").trim();
      logGatewayPlugWsLine(dev || "?", v);
    }

    this.dispatchTelemetryValue(k, v, sidNum, entityId);
  }

  private sendUnsubscribe(ws: WebSocket, sub: Sub): void {
    if (getNewgenWsUseCmdsFormat()) {
      ws.send(JSON.stringify({ cmds: [{ cmdId: sub.cmdId, unsubscribe: true }] }));
      return;
    }
    const unsubMsg =
      sub.subType === "ts"
        ? { tsSubCmds: [{ cmdId: sub.cmdId, unsubscribe: true }], attrSubCmds: [], historyCmds: [] }
        : {
            tsSubCmds: [],
            attrSubCmds: [{ cmdId: sub.cmdId, unsubscribe: true }],
            historyCmds: [],
          };
    ws.send(JSON.stringify(unsubMsg));
  }

  private ws: WebSocket | null = null;
  private nextId = 1;
  private subs = new Map<number, Sub>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private connecting = false;
  private wsAuthFatal = false;
  private lastWsTokenFingerprint = "";

  private smartSwitchListeners = new Map<string, Set<SmartSwitchWsListener>>();

  subscribeSmartSwitch(deviceId: string, cb: SmartSwitchWsListener): () => void {
    const id = deviceId.trim();
    if (!id) return () => {};
    let set = this.smartSwitchListeners.get(id);
    if (!set) {
      set = new Set();
      this.smartSwitchListeners.set(id, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.smartSwitchListeners.delete(id);
    };
  }

  private parseCmdId(raw: unknown): number {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") return Number(raw);
    return NaN;
  }

  private resolveSmartSwitchEntity(
    msg: Record<string, unknown>,
    msgEntity: string | undefined,
  ): string | undefined {
    const direct = msgEntity?.trim() || readMsgEntityIdDeep(msg as TbWsMsg);
    if (direct) return direct;

    const trySub = (cmdId: unknown): string | undefined => {
      const sid = this.parseCmdId(cmdId);
      if (Number.isNaN(sid) || sid === 0) return undefined;
      return this.subs.get(sid)?.deviceId;
    };

    const rootSid =
      trySub((msg as { subscriptionId?: unknown }).subscriptionId) ??
      trySub((msg as { cmdId?: unknown }).cmdId);
    if (rootSid) return rootSid;

    const ascRaw = msg.attrSubCmds;
    if (Array.isArray(ascRaw)) {
      for (const part of ascRaw) {
        if (!part || typeof part !== "object") continue;
        const d = trySub((part as { cmdId?: unknown }).cmdId);
        if (d) return d;
      }
    }
    const cmdsRaw = msg.cmds;
    if (Array.isArray(cmdsRaw)) {
      for (const part of cmdsRaw) {
        if (!part || typeof part !== "object") continue;
        const d = trySub((part as { cmdId?: unknown }).cmdId);
        if (d) return d;
      }
    }
    if (this.smartSwitchListeners.size === 1) {
      const only = [...this.smartSwitchListeners.keys()][0];
      if (only) return only;
    }
    return undefined;
  }

  private deliverSmartSwitchFromMsg(
    msg: Record<string, unknown>,
    msgEntity: string | undefined,
  ): void {
    if (this.smartSwitchListeners.size === 0) return;
    const effectiveEntity = this.resolveSmartSwitchEntity(msg, msgEntity);
    if (!effectiveEntity?.trim()) return;

    const sink = (key: string, value: unknown) => {
      const on = parseSwitchBool(value);
      for (const [subDeviceId, cbs] of this.smartSwitchListeners) {
        if (!entityIdsMatch(subDeviceId, effectiveEntity)) continue;
        for (const listener of cbs) {
          try { listener(key, on); } catch {}
        }
      }
    };
    processAttrs(msg.data, sink);
    if (msg.data && typeof msg.data === "object" && "data" in (msg.data as object)) {
      processAttrs((msg.data as { data: unknown }).data, sink);
    }
    const asc = msg.attrSubCmds;
    if (asc && typeof asc === "object" && !Array.isArray(asc) && "data" in (asc as object)) {
      processAttrs((asc as { data: unknown }).data, sink);
    }
  }

  ensureConnected(): void {
    if (this.wsAuthFatal) return;
    if (this.connecting) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.connecting = true;

    void this.resolveTokenAndConnect();
  }

  private async resolveTokenAndConnect(): Promise<void> {
    const envJwt = getNewgenWsJwt();
    const cached = getCachedLoginJwt();
    const apiKey = getNewgenSampleDevicesApiKey();

    let token = "";
    if (envJwt && !isJwtExpired(envJwt)) {
      token = envJwt;
    } else if (cached && !isJwtExpired(cached)) {
      token = cached;
    } else {
      const fresh = await tbLogin();
      if (fresh) {
        token = fresh;
      } else if (apiKey) {
        token = apiKey;
      }
    }

    if (!token) {
      addLog("[ws]", "No valid token available — cannot connect WS");
      this.connecting = false;
      if (this.subs.size > 0) this.scheduleReconnect();
      return;
    }

    if (token !== this.lastWsTokenFingerprint) {
      this.lastWsTokenFingerprint = token;
      this.wsAuthFatal = false;
    }

    this.connectWithToken(token);
  }

  private connectWithToken(token: string): void {
    const baseUrl = getNewgenWsTelemetryUrl();
    const urlWithToken = `${baseUrl}?token=${encodeURIComponent(token)}`;

    const ws = (this.ws = new WebSocket(urlWithToken));

    ws.onopen = () => {
      this.connecting = false;
      this.reconnectDelay = RECONNECT_BASE_MS;

      if (getNewgenWsUseCmdsFormat()) {
        const cmds = [...this.subs.values()].map((s) => this.buildNewgenCmd(s));
        const authCmd = { cmdId: 0, type: "AUTH" as const, token };
        if (cmds.length > 0) {
          ws.send(JSON.stringify({ authCmd, cmds }));
        } else {
          ws.send(JSON.stringify({ authCmd }));
        }
        return;
      }

      const authMsg = { authCmd: { cmdId: 0, token } };
      ws.send(JSON.stringify(authMsg));
      for (const sub of this.subs.values()) this.doSend(ws, sub);
    };

    ws.onmessage = ({ data }) => {
      try {
        const raw = String(data);
        const msg = JSON.parse(raw) as TbWsMsg;

        const err = msg.errorCode ?? 0;
        const msgEntity = readMsgEntityId(msg);

        this.deliverSmartSwitchFromMsg(msg as Record<string, unknown>, msgEntity);

        let hadAttrSubPartDispatch = false;
        const ascRaw = (msg as { attrSubCmds?: unknown }).attrSubCmds;
        if (Array.isArray(ascRaw)) {
          for (const part of ascRaw) {
            if (!part || typeof part !== "object") continue;
            const p = part as Record<string, unknown>;
            const partErr = typeof p.errorCode === "number" ? p.errorCode : 0;
            if (partErr !== 0) continue;

            const scmd = p.cmdId;
            const sidNum =
              typeof scmd === "number"
                ? scmd
                : scmd !== undefined && scmd !== null && String(scmd).trim() !== ""
                  ? Number(scmd)
                  : NaN;

            const flat = flattenAttributeData(p.data);
            for (const key of Object.keys(flat)) {
              this.dispatchWsAttrKey(key, flat[key], sidNum, msgEntity);
              hadAttrSubPartDispatch = true;
            }
          }
        }

        let hadCmdsPartDispatch = false;
        const cmdsRaw = (msg as { cmds?: unknown }).cmds;
        if (Array.isArray(cmdsRaw)) {
          for (const part of cmdsRaw) {
            if (!part || typeof part !== "object") continue;
            const p = part as Record<string, unknown>;
            if (p.type === "AUTH") continue;

            const scmd = p.cmdId;
            const sidNum =
              typeof scmd === "number"
                ? scmd
                : scmd !== undefined && scmd !== null && String(scmd).trim() !== ""
                  ? Number(scmd)
                  : NaN;
            if (sidNum === 0) continue;

            const partErr = typeof p.errorCode === "number" ? p.errorCode : 0;
            if (partErr !== 0) continue;

            let flat = flattenAttributeData(p.data);
            if (Object.keys(flat).length === 0 && p.update !== undefined) {
              flat = flattenAttributeData(p.update);
            }
            if (Object.keys(flat).length === 0 && p.result !== undefined) {
              flat = flattenAttributeData(p.result);
            }
            for (const key of Object.keys(flat)) {
              this.dispatchWsAttrKey(key, flat[key], sidNum, msgEntity);
              hadCmdsPartDispatch = true;
            }
          }
        }

        const dataObj = mergeTbWsPayloadData(msg);
        const mergedKeys = dataObj ? Object.keys(dataObj) : [];
        if (mergedKeys.length === 0 && !hadAttrSubPartDispatch && !hadCmdsPartDispatch) {
          if (err !== 0) return;
          return;
        }

        if (mergedKeys.length > 0) {
          const rawSid = msg.subscriptionId ?? (msg as { cmdId?: unknown }).cmdId;
          const sidNum =
            typeof rawSid === "number"
              ? rawSid
              : rawSid !== undefined && rawSid !== null && String(rawSid).trim() !== ""
                ? Number(rawSid)
                : NaN;

          for (const k of mergedKeys) {
            this.dispatchWsAttrKey(k, dataObj![k], sidNum, msgEntity);
          }
        }
      } catch {}
    };

    ws.onclose = (ev) => {
      this.connecting = false;
      const reason = ev.reason || "";
      if (this.ws === ws) this.ws = null;

      const invalidJwt =
        /invalid\s+jwt|jwt\s+token|token\s+expired|unauthori[sz]ed/i.test(reason) ||
        (ev.code === 1011 && /jwt|token/i.test(reason));
      if (invalidJwt) {
        rejectCachedLoginJwt();
        addLog("[ws]", "JWT rejected — login retry paused for 60 seconds");
        if (this.subs.size > 0) this.scheduleReconnect();
        return;
      }

      if (this.subs.size > 0) this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private buildNewgenCmd(sub: Sub) {
    const keysWire =
      sub.batchKeys && sub.batchKeys.length > 0 ? sub.batchKeys.join(",") : sub.key;

    if (sub.subType === "ts") {
      return {
        type: "TIMESERIES" as const,
        entityType: "DEVICE" as const,
        entityId: sub.deviceId,
        scope: "LATEST_TELEMETRY" as const,
        keys: keysWire,
        cmdId: sub.cmdId,
        unsubscribe: false as const,
      };
    }

    if (sub.subType === "attr_any") {
      return {
        type: "ATTRIBUTES" as const,
        entityType: "DEVICE" as const,
        entityId: sub.deviceId,
        scope: null as unknown as string,
        keys: keysWire,
        cmdId: sub.cmdId,
        unsubscribe: false as const,
      };
    }

    let scope: "CLIENT_SCOPE" | "SERVER_SCOPE" | "SHARED_SCOPE";
    if (sub.subType === "client_attr") scope = "CLIENT_SCOPE";
    else if (sub.subType === "shared_attr") scope = "SHARED_SCOPE";
    else scope = "SERVER_SCOPE";

    return {
      type: "ATTRIBUTES" as const,
      entityType: "DEVICE" as const,
      entityId: sub.deviceId,
      scope,
      keys: keysWire,
      cmdId: sub.cmdId,
      unsubscribe: false as const,
    };
  }

  private doSend(ws: WebSocket, sub: Sub): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    if (getNewgenWsUseCmdsFormat()) {
      const cmd = this.buildNewgenCmd(sub);
      ws.send(JSON.stringify({ cmds: [cmd] }));
      return;
    }

    const keysWire =
      sub.batchKeys && sub.batchKeys.length > 0 ? sub.batchKeys.join(",") : sub.key;

    const tsBase = {
      entityType: "DEVICE",
      entityId: sub.deviceId,
      scope: "LATEST_TELEMETRY",
      type: "TIMESERIES",
      cmdId: sub.cmdId,
      keys: keysWire,
    };

    const attrBase = {
      entityType: "DEVICE",
      entityId: sub.deviceId,
      cmdId: sub.cmdId,
      keys: keysWire,
      ...(sub.subType === "client_attr"
        ? { scope: "CLIENT_SCOPE" as const }
        : sub.subType === "shared_attr"
          ? { scope: "SHARED_SCOPE" as const }
          : sub.subType === "attr"
            ? { scope: "SERVER_SCOPE" as const }
            : {}),
    };
    const msg =
      sub.subType === "ts"
        ? { tsSubCmds: [tsBase], attrSubCmds: [], historyCmds: [] }
        : { tsSubCmds: [], attrSubCmds: [attrBase], historyCmds: [] };
    ws.send(JSON.stringify(msg));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, RECONNECT_MAX_MS);
      this.ensureConnected();
    }, this.reconnectDelay);
  }

  subscribe(
    deviceId: string,
    key: string,
    subType: "ts" | "attr" | "attr_any" | "client_attr" | "shared_attr",
    cb: ValueCb,
  ): () => void {
    for (const [existingId, existing] of [...this.subs.entries()]) {
      if (existing.deviceId === deviceId && existing.key === key && existing.subType === subType) {
        this.subs.delete(existingId);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.sendUnsubscribe(this.ws, existing);
        }
      }
    }

    const cmdId = this.nextId++;
    const sub: Sub = { cmdId, deviceId, key, subType, cb };
    this.subs.set(cmdId, sub);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.doSend(this.ws, sub);
    } else {
      this.ensureConnected();
    }

    return () => {
      this.subs.delete(cmdId);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendUnsubscribe(this.ws, sub);
      }
    };
  }

  subscribeBatch(
    deviceId: string,
    batchKeys: readonly string[],
    subType: "client_attr" | "shared_attr" | "attr" | "attr_any" | "ts",
    cb: BatchAttrCb,
  ): () => void {
    for (const [existingId, existing] of [...this.subs.entries()]) {
      if (
        existing.deviceId === deviceId &&
        existing.subType === subType &&
        existing.batchKeys &&
        existing.batchKeys.length === batchKeys.length &&
        existing.batchKeys.join(",") === batchKeys.join(",")
      ) {
        this.subs.delete(existingId);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.sendUnsubscribe(this.ws, existing);
        }
      }
    }

    const cmdId = this.nextId++;
    const sub: Sub = {
      cmdId,
      deviceId,
      key: `batch|${subType}|${batchKeys.join(",")}`,
      batchKeys,
      batchAttrCb: cb,
      subType,
      cb: () => {},
    };
    this.subs.set(cmdId, sub);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.doSend(this.ws, sub);
    } else {
      this.ensureConnected();
    }

    return () => {
      this.subs.delete(cmdId);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendUnsubscribe(this.ws, sub);
      }
    };
  }
}

export const tbWsManager = new TbWsManager();
