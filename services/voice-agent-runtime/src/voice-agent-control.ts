import type { VoiceAgentControlMessage } from "@translation/contracts";

export function parseVoiceAgentControl(
  data: Uint8Array,
): VoiceAgentControlMessage | null {
  if (data.byteLength > 2_048) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(data)) as
      Partial<VoiceAgentControlMessage>;
    if (value.version !== 1 || typeof value.controlId !== "string" ||
      typeof value.callId !== "string" || !Number.isInteger(value.generation) ||
      !["takeover", "cancel", "resume"].includes(String(value.command)) ||
      typeof value.issuedAt !== "string" || typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.issuedAt)) ||
      !Number.isFinite(Date.parse(value.expiresAt))) return null;
    return value as VoiceAgentControlMessage;
  } catch {
    return null;
  }
}
