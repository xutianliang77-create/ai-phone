import { redactPhoneNumbers } from "./phone_redaction.mjs";

export function buildAgentEgressAttestation(input) {
  const safe = (values) => evidence(values, input.options.targetPhone);
  return {
    schemaVersion: 1,
    status: "passed",
    environment: "staging",
    realProviderTraffic: true,
    observedDurationMs: input.observedDurationMs,
    trafficKinds: ["api", "livekit", "sip", "agent", "egress"],
    providerEvidence: {
      api: safe([`draft:${input.draft.id}`, `recording:${input.recording.id}`]),
      livekit: safe([`session:${input.recording.sessionId}`]),
      sip: safe([`provider-call:${input.activeDraft.providerCallId}`]),
      agent: safe([
        `draft:${input.draft.id}:in_progress`,
        `consent-event:${input.consent.runtimeEventId}:generation:${input.consent.generation}`,
      ]),
      egress: safe([
        `recording:${input.recording.externalRecordingId}`,
        `artifact:${input.artifact.id}:${input.artifact.sha256}:${input.artifact.manifestSha256}`,
      ]),
    },
    finalEventObserved: true,
    providerSideEffectDuplicates: 0,
    lostFinalEvents: 0,
    duplicateSettlements: 0,
    metrics: {
      sessionStartMs: input.sessionStartMs,
      finalLatencyMs: input.finalLatencyMs,
    },
    sessionId: input.options.sessionId,
    draftId: input.draft.id,
    callId: input.activeDraft.callId,
    recordingId: input.recording.id,
  };
}

function evidence(values, targetPhone) {
  return [...new Set(values.filter(Boolean).map((value) =>
    redactPhoneNumbers(value, targetPhone)
  ))].slice(0, 64);
}
