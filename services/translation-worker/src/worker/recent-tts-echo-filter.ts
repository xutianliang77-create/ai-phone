import type { CallAudioSpeakerRole } from "./types.js";

interface RecentTtsText {
  text: string;
  expiresAtMs: number;
}

export class RecentTtsEchoFilter {
  private readonly entries = new Map<string, RecentTtsText[]>();

  remember(
    callId: string,
    targetSpeakerRole: CallAudioSpeakerRole,
    text: string,
    expiresAtMs: number,
  ) {
    const normalized = normalizeEchoText(text);
    if (!normalized) return;
    const key = participantKey(callId, targetSpeakerRole);
    const active = this.activeEntries(key, expiresAtMs).slice(-5);
    this.entries.set(key, [...active, { text: normalized, expiresAtMs }]);
  }

  forget(
    callId: string,
    targetSpeakerRole: CallAudioSpeakerRole,
    text: string,
  ) {
    const normalized = normalizeEchoText(text);
    const key = participantKey(callId, targetSpeakerRole);
    const remaining = (this.entries.get(key) ?? []).filter(
      (entry) => entry.text !== normalized,
    );
    if (remaining.length === 0) this.entries.delete(key);
    else this.entries.set(key, remaining);
  }

  matches(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    text: string,
    nowMs: number,
  ) {
    const candidate = normalizeEchoText(text);
    if (candidate.length < 6) return false;
    const key = participantKey(callId, speakerRole);
    const active = this.activeEntries(key, nowMs);
    if (active.length === 0) {
      this.entries.delete(key);
      return false;
    }
    this.entries.set(key, active);
    return active.some((entry) => isNearEcho(candidate, entry.text));
  }

  clear(callId: string) {
    this.entries.delete(participantKey(callId, "host"));
    this.entries.delete(participantKey(callId, "guest"));
  }

  private activeEntries(key: string, nowMs: number) {
    return (this.entries.get(key) ?? []).filter((entry) =>
      entry.expiresAtMs >= nowMs
    );
  }
}

function participantKey(callId: string, role: CallAudioSpeakerRole) {
  return `${callId}:${role}`;
}

function normalizeEchoText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function isNearEcho(candidate: string, reference: string) {
  if (candidate === reference) return true;
  const shorter = candidate.length <= reference.length ? candidate : reference;
  const longer = shorter === candidate ? reference : candidate;
  return longer.includes(shorter) && shorter.length / longer.length >= 0.6;
}
