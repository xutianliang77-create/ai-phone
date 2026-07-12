import type { VoicePresetCatalogResponse } from "@translation/contracts";

export async function loadVoicePresetCatalog(): Promise<VoicePresetCatalogResponse> {
  const endpoint = process.env.TTS_HTTP_ENDPOINT?.trim();
  if (!endpoint) throw new Error("TTS voice preset provider is not configured");
  const response = await fetch(voicePresetUrl(endpoint), {
    headers: process.env.TTS_HTTP_API_KEY
      ? { authorization: `Bearer ${process.env.TTS_HTTP_API_KEY}` }
      : {},
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`TTS voice preset provider returned HTTP ${response.status}`);
  }
  return validateCatalog(await response.json());
}

function voicePresetUrl(endpoint: string) {
  const url = new URL(endpoint);
  url.pathname = "/voice-presets";
  url.search = "";
  return url;
}

function validateCatalog(value: unknown): VoicePresetCatalogResponse {
  if (!isRecord(value) || typeof value.version !== "string" ||
      !Array.isArray(value.presets)) {
    throw new Error("TTS voice preset provider returned an invalid catalog");
  }
  const presets = value.presets.filter(isPublicPreset);
  const defaultPresetId = typeof value.defaultPresetId === "string" &&
      presets.some((preset) => preset.id === value.defaultPresetId)
    ? value.defaultPresetId
    : presets[0]?.id;
  return {
    version: value.version,
    ...(defaultPresetId ? { defaultPresetId } : {}),
    presets,
  };
}

function isPublicPreset(value: unknown): value is VoicePresetCatalogResponse["presets"][number] {
  if (!isRecord(value) || !isRecord(value.labels)) return false;
  return typeof value.id === "string" &&
    typeof value.labels.zh === "string" &&
    typeof value.labels.en === "string" &&
    typeof value.gender === "string" &&
    typeof value.tone === "string" &&
    typeof value.scenario === "string" &&
    typeof value.accent === "string" &&
    Array.isArray(value.languages) &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    typeof value.version === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
