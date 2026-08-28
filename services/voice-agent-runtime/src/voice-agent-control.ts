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
      !["pause", "takeover", "cancel", "resume"].includes(String(value.command)) ||
      typeof value.issuedAt !== "string" || typeof value.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.issuedAt)) ||
      !Number.isFinite(Date.parse(value.expiresAt))) return null;
    return value as VoiceAgentControlMessage;
  } catch {
    return null;
  }
}

export class VoiceAgentControlInbox {
  private readonly handled = new Set<string>();

  accept(input: {
    data: Uint8Array;
    hasParticipant: boolean;
    topic: string;
    callId: string;
    generation: number;
    nowMs?: number;
  }) {
    if (input.hasParticipant || input.topic !== "voice-agent.control.v1") {
      return null;
    }
    const message = parseVoiceAgentControl(input.data);
    const nowMs = input.nowMs ?? Date.now();
    if (!message || message.callId !== input.callId ||
      message.generation !== input.generation ||
      Date.parse(message.expiresAt) <= nowMs ||
      Date.parse(message.issuedAt) > nowMs + 5_000 ||
      this.handled.has(message.controlId)) return null;
    this.handled.add(message.controlId);
    if (this.handled.size > 100) {
      this.handled.delete(this.handled.values().next().value!);
    }
    return message.command;
  }
}
