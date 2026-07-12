export interface ApiEnv {
  apiPort: number;
  realtimeTokenSecret: string;
  realtimeWsEndpoint: string;
  publicCallBaseUrl: string;
  regionEdition: "domestic" | "international";
  dataRegion: string;
  callProviderPolicy: string;
  complianceProfile: string;
  realtimeStaleSessionGraceSeconds: number;
  realtimeStaleSessionSweepSeconds: number;
}

export function loadEnv(): ApiEnv {
  const regionEdition = parseRegionEdition(process.env.REGION_EDITION);
  return {
    apiPort: Number(process.env.API_PORT ?? 3000),
    realtimeTokenSecret: process.env.REALTIME_TOKEN_SECRET ?? "dev-secret",
    realtimeWsEndpoint: process.env.REALTIME_WS_ENDPOINT ?? "ws://localhost:3001/realtime",
    publicCallBaseUrl: process.env.PUBLIC_CALL_BASE_URL ?? "https://call.translation.local",
    regionEdition,
    dataRegion: process.env.DATA_REGION ?? (regionEdition === "domestic" ? "cn" : "us"),
    callProviderPolicy:
      process.env.CALL_PROVIDER_POLICY ??
      (regionEdition === "domestic" ? "call_link_only" : "pstn_enabled"),
    complianceProfile:
      process.env.COMPLIANCE_PROFILE ??
      (regionEdition === "domestic" ? "pipl" : "us_ca"),
    realtimeStaleSessionGraceSeconds: positiveNumber(
      process.env.REALTIME_STALE_SESSION_GRACE_SECONDS,
      300,
    ),
    realtimeStaleSessionSweepSeconds: positiveNumber(
      process.env.REALTIME_STALE_SESSION_SWEEP_SECONDS,
      30,
    ),
  };
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseRegionEdition(value: string | undefined): ApiEnv["regionEdition"] {
  return value === "international" ? "international" : "domestic";
}
