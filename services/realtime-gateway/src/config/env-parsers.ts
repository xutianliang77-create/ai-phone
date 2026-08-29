export type RealtimeProviderName =
  | "mock"
  | "openai"
  | "lmstudio"
  | "self_hosted"
  | "hymt2_self_hosted"
  | "qwen_live"
  | "tencent_trtc";
export type ResolvedRealtimeProviderName =
  | "mock"
  | "openai"
  | "lmstudio"
  | "qwen_live"
  | "unsupported";
export type AsrProviderName = "mock" | "http";
export type SpeakerProviderName = "off" | "http";
export type SpeakerRevisionProviderName = "off" | "http";
export type SpeakerRevisionMode = "shadow" | "apply";
export type SessionEventSinkName = "noop" | "api";
export type RegionEdition = "domestic" | "international";
export type LlmProviderName = "off" | "mock" | "openai_compatible";

export function parseRateLimitProvider(
  value: string | undefined,
): "memory" | "redis" {
  if (value === "redis") return "redis";
  if (value === "memory") return "memory";
  return process.env.NODE_ENV === "production" ? "redis" : "memory";
}

export function commaSeparated(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export function parseProviderName(
  value: string | undefined,
): RealtimeProviderName {
  if (value === "self_hosted") return "self_hosted";
  if (value === "hymt2_self_hosted") return "hymt2_self_hosted";
  if (value === "qwen_live") return "qwen_live";
  if (value === "tencent_trtc") return "tencent_trtc";
  if (value === "lmstudio") return "lmstudio";
  return value === "openai" ? "openai" : "mock";
}

export function resolveProviderName(
  provider: RealtimeProviderName,
): ResolvedRealtimeProviderName {
  if (provider === "self_hosted" || provider === "hymt2_self_hosted") {
    return "lmstudio";
  }
  if (provider === "qwen_live") return "qwen_live";
  if (provider === "tencent_trtc") return "unsupported";
  return provider;
}

export function parseRegionEdition(value: string | undefined): RegionEdition {
  return value === "international" ? "international" : "domestic";
}

export function parseAsrProviderName(value: string | undefined): AsrProviderName {
  return value === "http" ? "http" : "mock";
}

export function parseSessionEventSinkName(
  value: string | undefined,
): SessionEventSinkName {
  return value === "api" ? "api" : "noop";
}

export function parseLlmProviderName(
  value: string | undefined,
): LlmProviderName {
  if (value === "mock" || value === "openai_compatible") return value;
  return "off";
}

export function parseSpeakerRevisionProvider(
  value: string | undefined,
): SpeakerRevisionProviderName {
  const normalized = value?.trim().toLowerCase() || "off";
  if (normalized === "off" || normalized === "http") return normalized;
  throw new Error(`Unsupported SPEAKER_REVISION_PROVIDER: ${normalized}`);
}

export function parseSpeakerRevisionMode(
  value: string | undefined,
): SpeakerRevisionMode {
  const normalized = value?.trim().toLowerCase() || "shadow";
  if (normalized === "shadow" || normalized === "apply") return normalized;
  throw new Error(`Unsupported SPEAKER_REVISION_MODE: ${normalized}`);
}

export function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}
