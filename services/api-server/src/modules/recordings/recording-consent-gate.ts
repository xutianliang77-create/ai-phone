import type {
  ParticipantRecordingConsentDto,
} from "@translation/contracts";
import type { AgentCallRecord } from "../agent-calls/agent-call-record.js";
import type { CallLegRecord } from "../call-links/call-link-record.js";

export type RecordingConsentGateResult =
  | {
      ok: true;
      participantLegs: CallLegRecord[];
      consents: ParticipantRecordingConsentDto[];
    }
  | { ok: false; code: string; message: string };

export function evaluateRecordingConsentGate(input: {
  purpose: "human_call" | "voice_agent";
  policyVersion: string;
  callLegs: CallLegRecord[];
  latestConsents: Map<string, ParticipantRecordingConsentDto>;
  agentDraft?: AgentCallRecord | null;
  dispatchGeneration?: number;
  now?: Date;
}): RecordingConsentGateResult {
  return input.purpose === "voice_agent"
    ? voiceAgentGate(input)
    : humanCallGate(input);
}

function humanCallGate(input: Parameters<typeof evaluateRecordingConsentGate>[0]) {
  const legs = input.callLegs.filter((leg) =>
    leg.status === "active" && ["host", "guest"].includes(leg.participantRole)
  );
  if (legs.length < 2) return failure(
    "recording_participants_incomplete",
    "Two participants are required",
  );
  if (legs.some((leg) => leg.joinType === "sip")) return failure(
    "sip_recording_consent_required",
    "SIP recording requires runtime-verified callee consent",
  );
  const consents = legs.map((leg) =>
    input.latestConsents.get(leg.participantIdentity)
  );
  if (consents.some((consent) => !validHumanConsent(
    consent,
    input.policyVersion,
    input.now,
  ))) return failure(
    "recording_consent_incomplete",
    "All participants must consent",
  );
  return { ok: true as const, participantLegs: legs, consents: present(consents) };
}

function voiceAgentGate(input: Parameters<typeof evaluateRecordingConsentGate>[0]) {
  const draft = input.agentDraft;
  if (!draft?.recordingRequested ||
    draft.recordingPolicyVersion !== input.policyVersion) return failure(
      "voice_agent_recording_not_authorized",
      "The user did not authorize this recording policy",
    );
  if (!input.dispatchGeneration) return failure(
    "voice_agent_generation_conflict",
    "Voice Agent dispatch generation is unavailable",
  );
  const worker = input.callLegs.find((leg) =>
    leg.status === "active" && leg.participantRole === "worker" &&
    leg.joinType === "worker"
  );
  const sipLegs = input.callLegs.filter((leg) =>
    leg.status === "active" && leg.participantRole === "guest" &&
    leg.joinType === "sip"
  );
  if (!worker || sipLegs.length !== 1) return failure(
    "voice_agent_recording_participants_incomplete",
    "One bound runtime and one SIP callee are required",
  );
  const consent = input.latestConsents.get(sipLegs[0].participantIdentity);
  if (!validVoiceAgentConsent(
    consent,
    input.policyVersion,
    input.dispatchGeneration,
    input.now,
  )) return failure(
    "voice_agent_recording_consent_incomplete",
    "A current runtime-verified callee consent is required",
  );
  return { ok: true as const, participantLegs: sipLegs, consents: [consent] };
}

function validHumanConsent(
  consent: ParticipantRecordingConsentDto | undefined,
  policyVersion: string,
  now = new Date(),
) {
  return Boolean(consent && consent.status === "granted" &&
    consent.policyVersion === policyVersion &&
    (!consent.source || consent.source === "participant_token") &&
    (!consent.expiresAt || Date.parse(consent.expiresAt) > now.getTime()));
}

function validVoiceAgentConsent(
  consent: ParticipantRecordingConsentDto | undefined,
  policyVersion: string,
  generation: number,
  now = new Date(),
): consent is ParticipantRecordingConsentDto {
  return Boolean(consent && consent.status === "granted" &&
    consent.policyVersion === policyVersion &&
    consent.source === "voice_agent_runtime" &&
    consent.participantRole === "guest" && consent.joinType === "sip" &&
    consent.generation === generation && consent.runtimeEventId &&
    /^[a-f0-9]{64}$/.test(consent.evidenceHash ?? "") &&
    Number.isFinite(Date.parse(consent.observedAt ?? "")) &&
    Date.parse(consent.expiresAt ?? "") > now.getTime());
}

function present(values: Array<ParticipantRecordingConsentDto | undefined>) {
  return values.filter((value): value is ParticipantRecordingConsentDto => Boolean(value));
}

function failure(code: string, message: string) {
  return { ok: false as const, code, message };
}
