import { randomUUID } from "node:crypto";

const DEFAULT_EXCHANGE_URL =
  "https://api.newgenjsc.com/auth/api/v1/exchange-tammi";

function setCorsHeaders(req, res) {
  const origin = String(req.headers.origin ?? "").trim();
  const allowedOrigins = String(process.env.NEWGEN_TAMMI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Request-Id");
  res.setHeader("Cache-Control", "no-store");
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body !== "string" || !req.body.trim()) return {};
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
  }

  const serviceAuth = String(process.env.NEWGEN_SERVICE_AUTH ?? "").trim();
  if (!serviceAuth) {
    return res.status(500).json({
      data: null,
      error: { code: "SERVER_MISCONFIGURED", message: "Missing NEWGEN_SERVICE_AUTH" },
    });
  }

  const body = readBody(req);
  const authCode = String(body.authCode ?? "").trim();
  if (!authCode) {
    return res.status(400).json({
      data: null,
      error: { code: "INVALID_REQUEST", message: "authCode is required" },
    });
  }

  const exchangeUrl = String(
    process.env.NEWGEN_TAMMI_EXCHANGE_URL ?? DEFAULT_EXCHANGE_URL,
  ).trim();
  const requestId =
    String(req.headers["x-request-id"] ?? "").trim() || randomUUID();

  try {
    const upstream = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        "X-Service-Auth": serviceAuth,
      },
      body: JSON.stringify({ authCode }),
    });

    const text = await upstream.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = {
        data: null,
        error: {
          code: "INVALID_UPSTREAM_RESPONSE",
          message: text.slice(0, 500),
        },
      };
    }

    return res.status(upstream.status).json(payload);
  } catch (error) {
    return res.status(502).json({
      data: null,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
