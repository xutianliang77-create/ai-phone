export interface AirDeviceGatewayConfig {
  baseUrl: string;
  apiSecret: string;
  timeoutMs: number;
}

export function getAirDeviceGatewayConfig():
  | { ok: true; config: AirDeviceGatewayConfig }
  | { ok: false; issues: string[] } {
  const baseUrl = normalizedBaseUrl(process.env.AIR_DEVICE_GATEWAY_BASE_URL);
  const apiSecret = process.env.AIR_DEVICE_GATEWAY_API_SECRET?.trim() ?? "";
  const timeoutMs = Number(process.env.AIR_DEVICE_GATEWAY_TIMEOUT_MS ?? 5_000);
  const issues = [
    ...(baseUrl ? [] : ["AIR_DEVICE_GATEWAY_BASE_URL is invalid"]),
    ...(Buffer.byteLength(apiSecret) >= 32
      ? []
      : ["AIR_DEVICE_GATEWAY_API_SECRET must be at least 32 bytes"]),
    ...(Number.isInteger(timeoutMs) && timeoutMs >= 500 && timeoutMs <= 30_000
      ? []
      : ["AIR_DEVICE_GATEWAY_TIMEOUT_MS must be 500-30000"]),
  ];
  if (issues.length > 0 || !baseUrl) return { ok: false, issues };
  return { ok: true, config: { baseUrl, apiSecret, timeoutMs } };
}

function normalizedBaseUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username ||
      url.password || url.search || url.hash) return null;
    if (url.protocol === "http:" && !isLoopback(url.hostname)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "[::1]" || hostname === "::1";
}
