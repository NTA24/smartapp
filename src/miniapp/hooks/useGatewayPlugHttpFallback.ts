import { useCallback, useEffect, useRef, useState } from "react";
import { useGatewayPlugStateWs } from "../lib/tbWebSocket";
import { fetchDeviceGatewayPlugState } from "../services/deviceSync";

export function useGatewayPlugStateWithFallback(deviceId: string | null): {
  live: boolean | undefined;
  refreshFromHttp: () => Promise<void>;
} {
  const { on: wsState, wsRev } = useGatewayPlugStateWs(deviceId);
  const [httpState, setHttpState] = useState<boolean | undefined>(undefined);
  
  const [manualHttp, setManualHttp] = useState<boolean | undefined>(undefined);
  const wsSeen = useRef(false);
  const lastWsRev = useRef(0);

  useEffect(() => {
    lastWsRev.current = 0;
  }, [deviceId]);

  useEffect(() => {
    wsSeen.current = wsState !== undefined;
    if (wsState !== undefined) setHttpState(undefined);
  }, [wsState]);

  useEffect(() => {
    if (wsRev === lastWsRev.current) return;
    lastWsRev.current = wsRev;
    setManualHttp(undefined);
  }, [wsRev]);

  useEffect(() => {
    if (!deviceId) {
      setHttpState(undefined);
      return;
    }
    setHttpState(undefined);
    let cancelled = false;
    void fetchDeviceGatewayPlugState(deviceId).then((v) => {
      if (cancelled || v === null) return;
      if (wsSeen.current) return;
      setHttpState(v);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  const refreshFromHttp = useCallback(async () => {
    if (!deviceId) return;
    const v = await fetchDeviceGatewayPlugState(deviceId);
    if (v !== null) setManualHttp(v);
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && !wsSeen.current) void refreshFromHttp();
    }, 10_000);
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void refreshFromHttp();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [deviceId, refreshFromHttp]);

  let live: boolean | undefined;
  if (manualHttp !== undefined) live = manualHttp;
  else if (wsState !== undefined) live = wsState;
  else live = httpState;

  return { live, refreshFromHttp };
}
