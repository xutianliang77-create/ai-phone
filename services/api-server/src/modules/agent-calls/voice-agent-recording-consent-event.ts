import type {
  VoiceAgentRecordingConsentEvent,
} from "@translation/contracts";
import { liveKitSipParticipantIdentity } from
  "../call-links/livekit-sip-identity.js";
import { recordParticipantRecordingConsent } from
  "../recordings/recordings-runtime.repository.js";
import { stopRecordingsForConsentRevocation } from
  "../recordings/recording-consent-revocation.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import type { CallLinkRecord } from "../call-links/call-links.service.js";
import { voiceAgentRecordingConsentSnapshot } from
  "./voice-agent-recording-consent.js";

export function parseVoiceAgentRecordingConsentEvent(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!["granted", "revoked"].includes(String(item.status)) ||
    !bounded(item.policyVersion, 80) ||
    typeof item.evidenceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.evidenceHash) ||
    !timestamp(item.observedAt)) return null;
  return {
    status: item.status as VoiceAgentRecordingConsentEvent["status"],
    policyVersion: item.policyVersion,
    evidenceHash: item.evidenceHash,
    observedAt: item.observedAt,
  };
}

export async function applyVoiceAgentRecordingConsent(input: {
  call: CallLinkRecord;
  draft: AgentCallRecord;
  generation: number;
  eventId: string;
  consent: VoiceAgentRecordingConsentEvent;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const policy = voiceAgentRecordingConsentSnapshot({
    language: input.draft.language,
    callExpiresAt: input.call.expiresAt,
    now,
  });
  if (!input.draft.recordingRequested || !policy ||
    input.draft.recordingPolicyVersion !== policy.policyVersion ||
    input.consent.policyVersion !== policy.policyVersion) {
    return { ok: false as const, code: "policy_conflict" };
  }
  const observedAtMs = Date.parse(input.consent.observedAt);
  if (observedAtMs < now.getTime() - 300_000 ||
    observedAtMs > now.getTime() + 5_000 ||
    now.getTime() >= Date.parse(policy.expiresAt)) {
    return { ok: false as const, code: "expired" };
  }
  const participantIdentity = liveKitSipParticipantIdentity(
    input.call.sessionId,
    input.draft.providerOperationId!,
  );
  const consent = await withSessionWriteLock(input.call.sessionId, async () => {
    const session = await findSession(input.call.sessionId);
    const leg = session?.callLegs?.find((item) =>
      item.status === "active" && item.participantRole === "guest" &&
      item.joinType === "sip" &&
      item.participantIdentity === participantIdentity
    );
    if (!leg) return null;
    return recordParticipantRecordingConsent({
      sessionId: input.call.sessionId,
      participantIdentity,
      policyVersion: policy.policyVersion,
      granted: input.consent.status === "granted",
      source: "voice_agent_runtime",
      participantRole: "guest",
      joinType: "sip",
      generation: input.generation,
      runtimeEventId: input.eventId,
      evidenceHash: input.consent.evidenceHash,
      observedAt: input.consent.observedAt,
      expiresAt: policy.expiresAt,
      now,
    });
  });
  if (!consent) return { ok: false as const, code: "participant_conflict" };
  const stop = consent.status === "revoked"
    ? await stopRecordingsForConsentRevocation(input.call.sessionId)
    : { attempted: 0, failed: 0 };
  return { ok: true as const, consent, stop };
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
