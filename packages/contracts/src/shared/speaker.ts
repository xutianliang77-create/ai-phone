export const speakerRoles = [
  "self",
  "peer",
  "host",
  "guest",
  "agent",
  "worker",
  "speaker",
  "unknown",
] as const;

export type SpeakerRole = (typeof speakerRoles)[number];

export const speakerAttributionSources = [
  "participant_track",
  "diarization",
  "voice_identity",
  "language_role",
  "manual",
  "unknown",
] as const;

export type SpeakerAttributionSource =
  (typeof speakerAttributionSources)[number];

export interface SpeakerAttributionDto {
  speakerId: string;
  role: SpeakerRole;
  source: SpeakerAttributionSource;
  displayName?: string;
  confidence?: number;
}

export type SegmentTimingSource =
  | "model"
  | "client"
  | "participant_track"
  | "estimated";

export interface SegmentTimingDto {
  startMs: number;
  endMs: number;
  source: SegmentTimingSource;
  overlap?: boolean;
  activeSpeakerIds?: string[];
}

export type SpeakerAttributionMode =
  | "off"
  | "auto"
  | "participant_track"
  | "diarization"
  | "manual";

export interface SpeakerAttributionOptionsDto {
  mode: SpeakerAttributionMode;
  maxSpeakers?: 2 | 3 | 4;
  allowVoiceIdentity?: boolean;
}

export function isSpeakerAttribution(
  value: unknown,
): value is SpeakerAttributionDto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SpeakerAttributionDto>;
  return typeof candidate.speakerId === "string" &&
    candidate.speakerId.trim().length > 0 &&
    typeof candidate.role === "string" &&
    speakerRoles.includes(candidate.role as SpeakerRole) &&
    typeof candidate.source === "string" &&
    speakerAttributionSources.includes(
      candidate.source as SpeakerAttributionSource,
    ) &&
    (candidate.displayName === undefined ||
      (typeof candidate.displayName === "string" &&
        candidate.displayName.trim().length > 0)) &&
    (candidate.confidence === undefined ||
      (typeof candidate.confidence === "number" &&
        Number.isFinite(candidate.confidence) &&
        candidate.confidence >= 0 &&
        candidate.confidence <= 1));
}

export function isSegmentTiming(value: unknown): value is SegmentTimingDto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SegmentTimingDto>;
  return typeof candidate.startMs === "number" &&
    Number.isFinite(candidate.startMs) &&
    candidate.startMs >= 0 &&
    typeof candidate.endMs === "number" &&
    Number.isFinite(candidate.endMs) &&
    candidate.endMs >= candidate.startMs &&
    (candidate.source === "model" ||
      candidate.source === "client" ||
      candidate.source === "participant_track" ||
      candidate.source === "estimated") &&
    (candidate.overlap === undefined || typeof candidate.overlap === "boolean") &&
    (candidate.activeSpeakerIds === undefined ||
      (Array.isArray(candidate.activeSpeakerIds) &&
        candidate.activeSpeakerIds.every((item) =>
          typeof item === "string" && item.trim().length > 0)));
}
