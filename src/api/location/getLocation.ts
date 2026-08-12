export interface GetLocationParams {
  enableHighAccuracy?: string;
  address?: boolean;
}

export interface LocationCoords {
  longitude: string;
  latitude: string;
  accuracy: string;
}

export interface LocationAddress {
  city: string;
  province: string;
  area: string;
  road: string;
  addressLine: string;
  cityCode?: string;
}

export interface GetLocationResult {
  coords: LocationCoords;
  address?: LocationAddress;
}

function getErrorMsg(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const maybeMsg = record.msg ?? record.message ?? record.error;
    if (typeof maybeMsg === "string" && maybeMsg.trim()) return maybeMsg;
  }
  try {
    return JSON.stringify(error) || "Failed to get location";
  } catch {
    return "Failed to get location";
  }
}

const JSAPI_TIMEOUT_MS = 20_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function normalizeLocationResult(value: unknown): GetLocationResult | null {
  const root = asRecord(value);
  const record = asRecord(root?.data) ?? asRecord(root?.result) ?? root;
  if (!record) return null;
  const coordsRecord = asRecord(record.coords) ?? record;
  const latitude = String(coordsRecord.latitude ?? coordsRecord.lat ?? "").trim();
  const longitude = String(coordsRecord.longitude ?? coordsRecord.lng ?? coordsRecord.lon ?? "").trim();
  if (!latitude || !longitude) return null;
  const accuracy = String(coordsRecord.accuracy ?? "").trim();
  const address = asRecord(record.address);
  return {
    coords: { latitude, longitude, accuracy },
    ...(address ? { address: address as unknown as LocationAddress } : {}),
  };
}

export const getLocation = (
  params: GetLocationParams = {}
): Promise<GetLocationResult> => {
  return new Promise((resolve, reject) => {
    if (typeof window.WindVane?.call !== "function") {
      reject(
        new Error(
          "WindVane is not available. Please run in Mini App environment."
        )
      );
      return;
    }

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("WindVane getLocation timeout"));
    }, JSAPI_TIMEOUT_MS);

    window.WindVane.call(
      "WVLocation",
      "getLocation",
      params,
      (result: GetLocationResult) => {
        if (settled) return;
        const normalized = normalizeLocationResult(result);
        if (!normalized) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error("Location response did not include coordinates"));
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(normalized);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(new Error(getErrorMsg(error)));
      }
    );
  });
};
