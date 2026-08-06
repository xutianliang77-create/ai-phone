import { getReadyVoiceProfileTtsConfig } from
  "../voice-profiles/voice-profiles-runtime.service.js";

export async function getCallLinkTtsVoice(userId: string) {
  return await getReadyVoiceProfileTtsConfig(userId) ?? defaultCallLinkTtsVoice();
}

export function defaultCallLinkTtsVoice() {
  return {
    // Keep the fallback deterministic. A missing profile must not make the
    // provider choose a new voice for every synthesized segment.
    mode: "preset" as const,
    presetId: process.env.CALL_LINK_DEFAULT_TTS_PRESET_ID?.trim() ||
      "zh_female_natural",
    quality: "standard" as const,
  };
}
