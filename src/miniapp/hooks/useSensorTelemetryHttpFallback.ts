import { useCallback, useEffect, useRef, useState } from "react";

export function useSensorTelemetryHttpFallback(
  wsState: boolean | undefined,
  deviceId: string,
  fetchLatest: (id: string) => Promise<boolean | null>,
): boolean | undefined {
  const [httpAlarm, setHttpAlarm] = useState<boolean | undefined>(undefined);
  const wsRef = useRef<boolean | undefined>(undefined);
  wsRef.current = wsState;

  const pullHttp = useCallback(() => {
    if (!deviceId) return;
    void fetchLatest(deviceId).then((v) => {
      if (v === null || wsRef.current !== undefined) return;
      setHttpAlarm(v);
    });
  }, [deviceId, fetchLatest]);

  useEffect(() => {
    if (wsState !== undefined) setHttpAlarm(undefined);
  }, [wsState]);

  useEffect(() => {
    if (!deviceId) {
      setHttpAlarm(undefined);
      return;
    }
    setHttpAlarm(undefined);
    let cancelled = false;
    void fetchLatest(deviceId).then((v) => {
      if (cancelled || v === null || wsRef.current !== undefined) return;
      setHttpAlarm(v);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId, fetchLatest]);

  useEffect(() => {
    if (!deviceId) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && wsRef.current === undefined) pullHttp();
    }, 10_000);
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      pullHttp();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [deviceId, pullHttp]);

  if (wsState !== undefined) return wsState;
  return httpAlarm;
}
