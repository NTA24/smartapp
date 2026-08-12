import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getMiniAppAppId, getApiBase, saveAppId, STORAGE_KEY_APP_ID, DEFAULT_MINIAPP_APP_ID } from "../lib/config";
import { addLog } from "../lib/debugLog";
import { storeGet } from "../lib/store";
import { getAuthCode, onWindVaneReady } from "../services/auth";
import {
  getPhoneFromUserInfo,
  getUserInfoByAuthCode,
  type UserInfoResponse,
} from "../../api/authentication/getUserInfoByAuthCode";
import { getDevicesByUsername, type SmartBuildingDeviceRecord } from "../services/deviceSync";
import { extractCameraToken, extractCameraUIDs, MINIAPP_DEVICES_REFRESH_EVENT } from "../utils/cameraFlow";
import { isHomeCameraDevice, labelForCameraUid } from "../lib/homeCamera";
import { ZYAPP_CAMERA_TOKEN_STORAGE_KEY } from "../lib/storageKeys";

const RESYNC_LOADING_MAX_MS = 12_000;
const AUTH_RESUME_EVENT_SUPPRESS_MS = 1_500;

/** Chuỗi nhãn hiển thị theo thứ tự UID — dùng để biết tên camera đã đổi sau resync. */
function cameraListLabelSignature(uids: string[], devices: SmartBuildingDeviceRecord[]): string {
  return uids
    .map((u) => String(u).trim())
    .filter(Boolean)
    .map((uid) => labelForCameraUid(uid, devices))
    .join("\u0001");
}

function extractIotDevicesFromUserInfo(info: UserInfoResponse): SmartBuildingDeviceRecord[] {
  const raw = (info as Record<string, unknown>).iotDevices;
  if (!Array.isArray(raw)) return [];

  const getStableUuid = (rec: Record<string, unknown>): string => {
    const direct = String(rec.deviceId ?? "").trim();
    if (direct) return direct;
    const nested = rec.device as Record<string, unknown> | undefined;
    const nestedId = nested?.id as Record<string, unknown> | undefined;
    const fromNested = String(nestedId?.id ?? "").trim();
    if (fromNested) return fromNested;
    return "";
  };

  const normalizedText = (rec: Record<string, unknown>): string =>
    [
      rec.label,
      rec.name,
      rec.model,
      rec.type,
      rec.deviceType,
    ]
      .map((x) => String(x ?? "").toLowerCase().trim())
      .join(" ");

  const detectType = (rec: Record<string, unknown>): string => {
    const text = normalizedText(rec);

    // Ưu tiên map theo đúng naming thực tế từ BE user-info.
    if (/aqara\s*smart\s*plug\s*socket|smart\s*plug\s*socket/.test(text)) return "gateway_socket";
    if (/smart\s*switch/.test(text)) return "smart_switch";
    if (/smoke\s*sensor|cảm biến khói|cam bien khoi/.test(text)) return "smoke_sensor";
    if (/led\s*strip|strip\s*led|dải\s*led|dai\s*led/.test(text)) return "led_strip";
    if (/door\s*and\s*window\s*sensor|door\s*sensor|contact\s*sensor|cảm biến cửa|cam bien cua/.test(text)) {
      return "door_sensor";
    }
    if (/\bsiren\b|còi báo|coi bao/.test(text)) return "siren";
    if (/fence\s*sensor|hàng rào|hang rao/.test(text)) return "fence_sensor";
    if (/\bhuman\b|\bpir\b|\bpresence\b|\bngười\b/.test(text)) return "human_sensor";

    if (/\bfence\b|\bhàng rào\b|\bhang rao\b/.test(text)) return "fence_sensor";
    if (/\bdoor\b|\bcửa\b|\bcua\b|contact sensor/.test(text)) return "door_sensor";
    if (/\bsmoke\b|\bkhói\b|\bkhoi\b/.test(text)) return "smoke_sensor";
    if (/smart\s*plug|wall\s*socket|ổ\s*cắm|o\s*cam|gateway|home assistant/.test(text)) return "gateway_socket";
    if (/\bswitch\b|\bcông tắc\b|\bcong tac\b/.test(text)) return "smart_switch";
    return String(rec.type ?? rec.deviceType ?? "").trim() || "default";
  };

  const detectFenceChannel = (rec: Record<string, unknown>): 1 | 2 | undefined => {
    const text = [rec.label, rec.name]
      .map((x) => String(x ?? "").toLowerCase())
      .join(" ");
    if (/\bfence\s*2\b|\bfence2\b/.test(text)) return 2;
    if (/\bfence\b/.test(text)) return 1;
    return undefined;
  };

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      const deviceId = getStableUuid(rec);
      if (!deviceId) return null;
      const deviceType = detectType(rec);
      const fenceChannel = detectFenceChannel(rec);
      const baseName = String(rec.name ?? rec.label ?? "").trim() || deviceId;
      const baseLabel = String(rec.label ?? rec.name ?? "").trim() || deviceId;
      return {
        ...rec,
        deviceId,
        uuid: deviceId,
        wsDeviceId: deviceId,
        name: baseName,
        label: baseLabel,
        ...(deviceType ? { deviceType } : {}),
        ...(fenceChannel ? { fenceChannel } : {}),
        device: {
          id: { id: deviceId, entityType: "DEVICE" },
          name: baseName,
          label: baseLabel,
          type: deviceType,
        },
      } as SmartBuildingDeviceRecord;
    })
    .filter((item): item is SmartBuildingDeviceRecord => item !== null);
}

function mergeDevicesByDeviceId(
  preferred: SmartBuildingDeviceRecord[],
  fallback: SmartBuildingDeviceRecord[],
): SmartBuildingDeviceRecord[] {
  const map = new Map<string, SmartBuildingDeviceRecord>();
  for (const d of fallback) {
    const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
    if (id) map.set(id, d);
  }
  for (const d of preferred) {
    const id = String(d.deviceId ?? d.device?.id?.id ?? "").trim();
    if (id) map.set(id, d);
  }
  return Array.from(map.values());
}

function inferCameraUIDs(devices: SmartBuildingDeviceRecord[]): string[] {
  const knownCameraUIDs = new Set<string>();
  return devices
    .filter((device) => isHomeCameraDevice(device, knownCameraUIDs))
    .map((device) => String(device.deviceId ?? device.device?.id?.id ?? "").trim())
    .filter(Boolean);
}

interface MiniAppState {
  userPhone: string;
  accessToken: string;
  refreshToken: string;
  mqttToken: string;
  cameraToken: string;
  cameraUIDs: string[];
  devices: SmartBuildingDeviceRecord[];
  appId: string;
  apiBase: string;
  authModalVisible: boolean;
  authLoading: boolean;
  authError: string;
  /** true sau khi lần khởi tạo miniapp (WindVane + auth) chạy xong — dùng cho UI loading trang Camera. */
  miniAppInitialized: boolean;
  /** true khi đang resync sau SDK — tắt khi chuỗi nhãn camera khác snapshot (hoặc hết thời gian chờ). */
  sessionResyncLoading: boolean;
}

interface MiniAppContextValue extends MiniAppState {
  setUserPhone: (phone: string) => void;
  setDevices: (devices: SmartBuildingDeviceRecord[]) => void;
  refreshDevices: () => Promise<void>;
  setAuthModalVisible: (v: boolean) => void;
  requestAuthAndPhone: () => Promise<void>;
  saveAppId: (id: string) => void;
  clearAuthError: () => void;
}

const initialState: MiniAppState = {
  userPhone: typeof window !== "undefined" ? (window.MINIAPP_USER_PHONE ?? "") : "",
  accessToken: "",
  refreshToken: "",
  mqttToken: "",
  cameraToken: "",
  cameraUIDs: [],
  devices: [],
  appId: "",
  apiBase: getApiBase(),
  authModalVisible: false,
  authLoading: false,
  authError: "",
  miniAppInitialized: false,
  sessionResyncLoading: false,
};

const MiniAppContext = createContext<MiniAppContextValue | null>(null);

function hydrateStoredCameraData(): { cameraToken: string; cameraUIDs: string[] } {
  try {
    const raw = sessionStorage.getItem(ZYAPP_CAMERA_TOKEN_STORAGE_KEY);
    if (!raw) return { cameraToken: "", cameraUIDs: [] };
    const parsed = JSON.parse(raw) as unknown;
    return {
      cameraToken: extractCameraToken(parsed),
      cameraUIDs: extractCameraUIDs(parsed),
    };
  } catch {
    return { cameraToken: "", cameraUIDs: [] };
  }
}

export function MiniAppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MiniAppState>(() => ({
    ...initialState,
    appId: getMiniAppAppId(),
    ...hydrateStoredCameraData(),
  }));

  const didRequestRef = useRef(false);
  const miniAppInitializedRef = useRef(false);
  miniAppInitializedRef.current = state.miniAppInitialized;
  const resyncLabelSnapshotRef = useRef("");
  const lastIotDevicesRef = useRef<SmartBuildingDeviceRecord[]>([]);
  const oauthRequestInFlightRef = useRef<Promise<void> | null>(null);
  const oauthAuthenticatedRef = useRef(false);
  const suppressResumeRefreshUntilRef = useRef(0);

  const setUserPhone = useCallback((phone: string) => {
    setState((s) => ({ ...s, userPhone: phone }));
    if (typeof window !== "undefined") window.MINIAPP_USER_PHONE = phone;
  }, []);

  const setDevices = useCallback((devices: SmartBuildingDeviceRecord[]) => {
    const merged = mergeDevicesByDeviceId(devices, lastIotDevicesRef.current);
    const inferredCameraUIDs = inferCameraUIDs(merged);
    setState((s) => ({
      ...s,
      devices: merged,
      cameraUIDs:
        s.cameraUIDs.length > 0
          ? Array.from(new Set([...s.cameraUIDs, ...inferredCameraUIDs]))
          : inferredCameraUIDs,
    }));
  }, []);

  /** Cập nhật token, phone, camera và devices từ payload exchange-tammi. */
  const applyUserInfoFromOAuthResponse = useCallback(
    async (info: UserInfoResponse) => {
      const phone = getPhoneFromUserInfo(info);
      const accessToken = String(info.access_token ?? "").trim();
      const refreshToken = String(info.refresh_token ?? "").trim();
      const mqttToken = String(info.mqttToken ?? "").trim();
      const camToken = extractCameraToken(info);
      const camUIDs = extractCameraUIDs(info);
      const iotDevices = extractIotDevicesFromUserInfo(info);
      lastIotDevicesRef.current = iotDevices;
      setState((s) => ({
        ...s,
        accessToken: accessToken || s.accessToken,
        refreshToken: refreshToken || s.refreshToken,
        mqttToken: mqttToken || s.mqttToken,
      }));
      addLog(
        "[userinfo]",
        "response",
        JSON.stringify({
          tag: "context:parsed-iot",
          iotCount: iotDevices.length,
          iotIds: iotDevices.map((d) => String(d.deviceId ?? d.device?.id?.id ?? "").trim()).filter(Boolean),
        }),
      );

      if (camToken || camUIDs.length > 0) {
        setState((s) => ({ ...s, cameraToken: camToken, cameraUIDs: camUIDs }));
        try {
          sessionStorage.setItem(
            ZYAPP_CAMERA_TOKEN_STORAGE_KEY,
            JSON.stringify({ cameraToken: camToken, cameraUIDs: camUIDs }),
          );
        } catch {}
      }

      if (iotDevices.length > 0) {
        // Ưu tiên set sớm list iotDevices từ user-info để WS có deviceId ngay.
        setDevices(iotDevices);
      }

      if (phone) {
        setUserPhone(phone);
        // Khi user-info đã trả iotDevices thì coi đó là nguồn sự thật cho danh sách thiết bị.
        if (iotDevices.length > 0) return;
        try {
          const devices = await getDevicesByUsername(phone);
          const merged = mergeDevicesByDeviceId(devices, iotDevices);
          setDevices(merged);
        } catch {}
      }
      const P = window.MiniAppPermissions;
      if (P?.getSetting) {
        const settings = await P.getSetting().catch(() => null);
        if (settings?.authSetting && P.setPermissionStatus) {
          P.setPermissionStatus(settings.authSetting);
        }
      }
    },
    [setDevices, setUserPhone],
  );

  const setAuthModalVisible = useCallback((v: boolean) => {
    setState((s) => ({ ...s, authModalVisible: v }));
  }, []);

  const clearAuthError = useCallback(() => {
    setState((s) => ({ ...s, authError: "" }));
  }, []);

  const fetchAndApplyOAuthUserInfo = useCallback((): Promise<void> => {
    if (oauthRequestInFlightRef.current) return oauthRequestInFlightRef.current;

    suppressResumeRefreshUntilRef.current = Number.POSITIVE_INFINITY;
    const request = (async () => {
      const auth = await getAuthCode(["USER_NAME", "USER_PHONE_NUMBER"]);
      const info = await getUserInfoByAuthCode(auth.authCode);
      const accessToken = String(info.access_token ?? "").trim();
      const phone = getPhoneFromUserInfo(info);
      const cameraToken = extractCameraToken(info);
      if (!accessToken && !cameraToken) {
        throw new Error("Login response did not return an access token or camera token");
      }
      if (!phone) {
        throw new Error("exchange-tammi did not return a phone number. Phone permission is required.");
      }
      await applyUserInfoFromOAuthResponse(info);
      oauthAuthenticatedRef.current = true;
    })().finally(() => {
      suppressResumeRefreshUntilRef.current = Date.now() + AUTH_RESUME_EVENT_SUPPRESS_MS;
      oauthRequestInFlightRef.current = null;
    });

    oauthRequestInFlightRef.current = request;
    return request;
  }, [applyUserInfoFromOAuthResponse]);

  const refreshDevices = useCallback(async () => {
    if (lastIotDevicesRef.current.length > 0) {
      setDevices(lastIotDevicesRef.current);
      return;
    }
    const username = String(window.MINIAPP_USER_PHONE ?? state.userPhone ?? "").trim();
    if (!username) {
      setDevices(lastIotDevicesRef.current);
      return;
    }
    try {
      const devices = await getDevicesByUsername(username);
      setDevices(mergeDevicesByDeviceId(devices, lastIotDevicesRef.current));
    } catch {}
  }, [setDevices, state.userPhone]);

  useEffect(() => {
    addLog(
      "[userinfo]",
      "response",
      JSON.stringify({
        tag: "context:state-devices",
        stateCount: state.devices.length,
        stateIds: state.devices.map((d) => String(d.deviceId ?? d.device?.id?.id ?? "").trim()).filter(Boolean),
      }),
    );
  }, [state.devices]);

  const refreshOAuthUserInfo = useCallback(async () => {
    setState((s) => {
      resyncLabelSnapshotRef.current = cameraListLabelSignature(s.cameraUIDs, s.devices);
      return { ...s, sessionResyncLoading: true };
    });
    try {
      await fetchAndApplyOAuthUserInfo();
    } catch (error) {
      addLog("[auth]", "resume-refresh-failed", error instanceof Error ? error.message : String(error));
      await refreshDevices();
    }
  }, [fetchAndApplyOAuthUserInfo, refreshDevices]);

  const refreshOAuthUserInfoRef = useRef(refreshOAuthUserInfo);
  refreshOAuthUserInfoRef.current = refreshOAuthUserInfo;

  useEffect(() => {
    if (!state.sessionResyncLoading) return;
    const now = cameraListLabelSignature(state.cameraUIDs, state.devices);
    if (now !== resyncLabelSnapshotRef.current) {
      setState((s) => (s.sessionResyncLoading ? { ...s, sessionResyncLoading: false } : s));
    }
  }, [state.cameraUIDs, state.devices, state.sessionResyncLoading]);

  useEffect(() => {
    if (!state.sessionResyncLoading) return;
    const id = window.setTimeout(() => {
      setState((s) => (s.sessionResyncLoading ? { ...s, sessionResyncLoading: false } : s));
    }, RESYNC_LOADING_MAX_MS);
    return () => window.clearTimeout(id);
  }, [state.sessionResyncLoading]);

  /**
   * Chỉ đồng bộ lại sau khi native add-device flow kết thúc.
   * Không dùng focus/visibility để gọi lại OAuth vì Super App có thể phát
   * các event này trong lúc hiện permission sheet, gây exchange lặp.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const DEBOUNCE_MS = 400;
    let debounceId: number | null = null;
    const schedule = () => {
      if (debounceId !== null) window.clearTimeout(debounceId);
      debounceId = window.setTimeout(() => {
        debounceId = null;
        if (!miniAppInitializedRef.current) return;
        if (!oauthAuthenticatedRef.current) return;
        if (oauthRequestInFlightRef.current) return;
        if (Date.now() < suppressResumeRefreshUntilRef.current) return;
        void refreshOAuthUserInfoRef.current();
      }, DEBOUNCE_MS);
    };

    const onRefreshEvent = () => {
      schedule();
    };
    window.addEventListener(MINIAPP_DEVICES_REFRESH_EVENT, onRefreshEvent);

    return () => {
      window.removeEventListener(MINIAPP_DEVICES_REFRESH_EVENT, onRefreshEvent);
      if (debounceId !== null) window.clearTimeout(debounceId);
    };
  }, []);

  const requestAuthAndPhone = useCallback(async () => {
    setState((s) => ({
      ...s,
      authLoading: true,
      authError: "",
      miniAppInitialized: false,
    }));
    try {
      await fetchAndApplyOAuthUserInfo();
      setState((s) => ({ ...s, authModalVisible: false }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, authError: msg || "Auth flow failed" }));
      throw e;
    } finally {
      setState((s) => ({ ...s, authLoading: false, miniAppInitialized: true }));
    }
  }, [fetchAndApplyOAuthUserInfo]);

  const initializeMiniApp = useCallback(async (): Promise<void> => {
    addLog("[auth]", "waiting-for-windvane");
    await onWindVaneReady();

    if (!window.WindVane?.call) {
      addLog("[auth]", "windvane-unavailable");
      throw new Error("WindVane is unavailable. Open this miniapp inside the Super App.");
    }
    addLog("[auth]", "windvane-ready");

    const current = getMiniAppAppId();
    if (!current || current.trim() === "") {
      saveAppId(DEFAULT_MINIAPP_APP_ID);
      setState((s) => ({ ...s, appId: DEFAULT_MINIAPP_APP_ID }));
    }

    if (!didRequestRef.current) {
      didRequestRef.current = true;
      await requestAuthAndPhone();
    }
  }, [requestAuthAndPhone]);

  const saveAppIdCallback = useCallback((id: string) => {
    saveAppId(id);
    setState((s) => ({ ...s, appId: getMiniAppAppId() }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void initializeMiniApp().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      addLog("[auth]", "initialize-failed", message);
      setState((s) => ({
        ...s,
        authLoading: false,
        authError: message || "Auth flow failed",
        miniAppInitialized: true,
      }));
    });
    return undefined;
  }, [initializeMiniApp]);

  const value: MiniAppContextValue = {
    ...state,
    appId: state.appId || getMiniAppAppId(),
    setUserPhone,
    setDevices,
    refreshDevices,
    setAuthModalVisible,
    requestAuthAndPhone,
    saveAppId: saveAppIdCallback,
    clearAuthError,
  };

  return (
    <MiniAppContext.Provider value={value}>
      {children}
    </MiniAppContext.Provider>
  );
}

export function useMiniApp() {
  const ctx = useContext(MiniAppContext);
  if (!ctx) throw new Error("useMiniApp must be used within MiniAppProvider");
  return ctx;
}

export function getStoredAppId(): string {
  return storeGet(STORAGE_KEY_APP_ID) ?? "";
}
