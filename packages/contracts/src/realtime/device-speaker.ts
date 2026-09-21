import type { SpeakerAttributionOptionsDto } from "../shared/speaker.js";

export const deviceSpeakerProfile = Object.freeze({
  id: "sortformer_v2_1_fastest",
  revision: "ae9a27ab45dc0aa3abede7d2d6bad2b7a69aa6d1",
  maxSpeakers: 4 as const,
});

/** Anonymous, session-local annotations of audio already accepted by Gateway.
 * They never authorize inference, move a billing watermark or claim identity. */
export interface DeviceSpeakerEvidenceEvent {
  type: "speaker.evidence";
  sessionId: string;
  profile: string;
  modelRevision: string;
  sequence: number;
  sampleRate: 16000 | 24000;
  throughSample: number;
  spans: Array<{
    speaker: number;
    startSample: number;
    endSample: number;
    confidence: number;
    overlap: boolean;
  }>;
}

export function isDeviceSpeakerSelection(value: unknown): value is SpeakerAttributionOptionsDto & {
  mode: "diarization"; deviceProfile: string; maxSpeakers: 4; allowVoiceIdentity: false;
} {
  if (!record(value)) return false;
  return Object.keys(value).every(key => ["mode", "maxSpeakers", "allowVoiceIdentity", "deviceProfile"].includes(key)) &&
    value.mode === "diarization" && value.deviceProfile === deviceSpeakerProfile.id &&
    value.maxSpeakers === deviceSpeakerProfile.maxSpeakers && value.allowVoiceIdentity === false;
}

export function parseDeviceSpeakerEvidence(value: unknown, scope: {
  sessionId: string; sampleRate: 16000 | 24000; acceptedSamples: number;
}): DeviceSpeakerEvidenceEvent | null {
  if (!nonnegative(scope.acceptedSamples) || !record(value) || Object.keys(value).some(key => ![
    "type", "sessionId", "profile", "modelRevision", "sequence", "sampleRate", "throughSample", "spans",
  ].includes(key)) || value.type !== "speaker.evidence" || value.sessionId !== scope.sessionId ||
    value.profile !== deviceSpeakerProfile.id || value.modelRevision !== deviceSpeakerProfile.revision ||
    value.sampleRate !== scope.sampleRate || !positive(value.sequence) || !positive(value.throughSample) ||
    value.throughSample > scope.acceptedSamples || !Array.isArray(value.spans) || value.spans.length > 128) return null;
  let previousStart = -1;
  for (const span of value.spans) {
    if (!record(span) || Object.keys(span).some(key => ![
      "speaker", "startSample", "endSample", "confidence", "overlap",
    ].includes(key)) || !Number.isInteger(span.speaker) || Number(span.speaker) < 0 || Number(span.speaker) >= 4 ||
      !nonnegative(span.startSample) || !positive(span.endSample) || span.endSample <= span.startSample ||
      span.endSample > value.throughSample || span.startSample < Math.max(0, value.throughSample - scope.sampleRate * 30) ||
      span.startSample < previousStart || typeof span.confidence !== "number" || !Number.isFinite(span.confidence) ||
      span.confidence < 0 || span.confidence > 1 || typeof span.overlap !== "boolean") return null;
    previousStart = span.startSample;
  }
  return structuredClone(value) as unknown as DeviceSpeakerEvidenceEvent;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function positive(value: unknown): value is number { return nonnegative(value) && value > 0; }
