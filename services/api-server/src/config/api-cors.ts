type CorsOriginCallback = (error: Error | null, allow: boolean) => void;
type CorsOrigin = boolean | ((origin: string | undefined, callback: CorsOriginCallback) => void);

export function apiCorsOrigin(env: NodeJS.ProcessEnv = process.env): CorsOrigin {
  const allowed = parseAllowedOrigins(env.API_CORS_ALLOWED_ORIGINS);
  if (allowed.length === 0 && env.NODE_ENV === "production") return false;
  return (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowed.length > 0) return callback(null, allowed.includes(origin));
    callback(null, isLoopbackOrigin(origin));
  };
}

export function parseAllowedOrigins(value: string | undefined) {
  const origins = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (origins.includes("*")) throw new Error("API_CORS_ALLOWED_ORIGINS cannot contain wildcard");
  const normalized = origins.map((origin) => {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error(`Invalid CORS origin: ${origin}`); }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin ||
      url.username || url.password) throw new Error(`Invalid CORS origin: ${origin}`);
    return url.origin;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("API_CORS_ALLOWED_ORIGINS contains duplicates");
  }
  return normalized;
}

function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch { return false; }
}
