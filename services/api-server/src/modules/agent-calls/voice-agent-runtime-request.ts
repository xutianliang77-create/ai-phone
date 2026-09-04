import type {
  VoiceAgentAmdCategory,
  VoiceAgentRuntimeEventRequest,
  VoiceAgentStructuredResultDto,
} from "@translation/contracts";
import { parseVoiceAgentRecordingConsentEvent } from
  "./voice-agent-recording-consent-event.js";

export function parseVoiceAgentRuntimeSnapshotRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!bounded(value.ticket, 4096) || !bounded(value.participantIdentity, 256) ||
    !bounded(value.workerId, 128) || !bounded(value.jobId, 128)) return null;
  return {
    ticket: value.ticket,
    participantIdentity: value.participantIdentity,
    workerId: value.workerId,
    jobId: value.jobId,
  };
}

export function parseVoiceAgentRuntimeEvent(
  body: unknown,
): VoiceAgentRuntimeEventRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const events = [
    "ready", "heartbeat", "disclosure_started", "disclosure_completed",
    "recording_consent", "amd_classified", "ivr_detected", "takeover_ready",
    "response_start_timeout", "audio_capacity_exceeded",
    "structured_result", "failed", "ending",
  ];
  if (!bounded(value.ticket, 4096) || !bounded(value.eventId, 128) ||
    !events.includes(String(value.event)) || !optional(value.workerId, 128) ||
    !optional(value.jobId, 128) || !optional(value.errorClass, 80) ||
    !optional(value.transcriptSummary, 500)) return null;
  const amdCategory = parseAmd(value.amdCategory);
  if (value.amdCategory !== undefined && !amdCategory) return null;
  const result = parseResult(value.result);
  if (value.event === "structured_result" && !result) return null;
  const recordingConsent = parseVoiceAgentRecordingConsentEvent(
    value.recordingConsent,
  );
  if ((value.event === "recording_consent" && !recordingConsent) ||
    (value.event !== "recording_consent" && value.recordingConsent !== undefined)) {
    return null;
  }
  return {
    ticket: value.ticket,
    eventId: value.eventId,
    event: value.event as VoiceAgentRuntimeEventRequest["event"],
    ...(value.workerId ? { workerId: value.workerId as string } : {}),
    ...(value.jobId ? { jobId: value.jobId as string } : {}),
    ...(value.errorClass ? { errorClass: value.errorClass as string } : {}),
    ...(amdCategory ? { amdCategory } : {}),
    ...(value.transcriptSummary
      ? { transcriptSummary: value.transcriptSummary as string }
      : {}),
    ...(result ? { result } : {}),
    ...(recordingConsent ? { recordingConsent } : {}),
  };
}

function parseResult(value: unknown): VoiceAgentStructuredResultDto | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!["completed", "partial", "unresolved", "failed"].includes(
    String(item.outcome),
  ) || !bounded(item.summary, 800)) return null;
  const evidence = strings(item.evidence, 8, 300);
  const unresolvedItems = strings(item.unresolvedItems, 8, 300);
  if (!evidence || !unresolvedItems || !optional(item.nextStep, 300)) return null;
  return {
    outcome: item.outcome as VoiceAgentStructuredResultDto["outcome"],
    summary: item.summary,
    evidence,
    unresolvedItems,
    ...(item.nextStep ? { nextStep: item.nextStep as string } : {}),
  };
}

function parseAmd(value: unknown): VoiceAgentAmdCategory | null {
  return ["human", "machine-ivr", "machine-vm", "machine-unavailable", "uncertain"]
      .includes(String(value))
    ? value as VoiceAgentAmdCategory
    : null;
}

function strings(value: unknown, maximumItems: number, maximumBytes: number) {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  return value.every((item) => bounded(item, maximumBytes))
    ? value as string[]
    : null;
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function optional(value: unknown, maximum: number) {
  return value === undefined || bounded(value, maximum);
}
