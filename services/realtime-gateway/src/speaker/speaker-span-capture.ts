import type { AudioFrame } from "@translation/contracts";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import type { SpeakerBoundaryGuard } from "./speaker-transcript-attribution.js";

export interface SpeakerSpanCaptureOptions {
  enabled: boolean;
  maxSessions: number;
  maxDurationMs: number;
  maxRecords: number;
}

export class SpeakerSpanCapture {
  private readonly eligibleSessions = new Set<string>();
  private readonly startedAtMs = new Map<string, number>();
  private readonly recordCounts = new Map<string, number>();
  private sessionCount = 0;

  constructor(private readonly options: SpeakerSpanCaptureOptions) {}

  registerSession(sessionId: string, endpointMode?: string) {
    if (this.options.enabled && endpointMode === "listening") {
      this.eligibleSessions.add(sessionId);
    }
  }

  clearSession(sessionId: string) {
    this.eligibleSessions.delete(sessionId);
    this.startedAtMs.delete(sessionId);
    this.recordCounts.delete(sessionId);
  }

  record(input: {
    frame: AudioFrame;
    rawSpans: SpeakerSpan[];
    boundary: SpeakerBoundaryGuard | null;
    currentSpeakerId?: string;
  }) {
    const sessionId = input.frame.sessionId;
    if (!this.eligibleSessions.has(sessionId)) return;
    let startedAtMs = this.startedAtMs.get(sessionId);
    if (startedAtMs === undefined) {
      if (this.sessionCount >= this.options.maxSessions) {
        this.eligibleSessions.delete(sessionId);
        return;
      }
      startedAtMs = Date.now();
      this.startedAtMs.set(sessionId, startedAtMs);
      this.sessionCount += 1;
    }
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    const recordCount = this.recordCounts.get(sessionId) ?? 0;
    if (
      elapsedMs > this.options.maxDurationMs ||
      recordCount >= this.options.maxRecords
    ) {
      this.eligibleSessions.delete(sessionId);
      return;
    }
    this.recordCounts.set(sessionId, recordCount + 1);
    realtimeLogger.info({
      sessionId,
      sequence: input.frame.sequence,
      frameTimestampMs: input.frame.timestampMs,
      elapsedMs,
      rawSpeakerIds: [
        ...new Set(input.rawSpans.map((span) => span.speakerId)),
      ],
      rawSpans: input.rawSpans.map((span) => ({
        speakerId: span.speakerId,
        startMs: span.startMs,
        endMs: span.endMs,
        confidence: span.confidence,
        overlap: span.overlap === true,
        final: span.final === true,
      })),
      coordinatorCurrentSpeakerId: input.currentSpeakerId,
      coordinatorBoundary: input.boundary,
    }, "Bounded speaker span diagnostic capture");
  }
}

export function speakerSpanCaptureOptionsFromEnvironment(): SpeakerSpanCaptureOptions {
  return {
    enabled: process.env.SPEAKER_SPAN_CAPTURE_ENABLED === "true",
    maxSessions: Math.min(
      positiveInteger(process.env.SPEAKER_SPAN_CAPTURE_MAX_SESSIONS, 1),
      1,
    ),
    maxDurationMs: Math.min(
      positiveInteger(
        process.env.SPEAKER_SPAN_CAPTURE_MAX_DURATION_MS,
        120_000,
      ),
      120_000,
    ),
    maxRecords: Math.min(
      positiveInteger(process.env.SPEAKER_SPAN_CAPTURE_MAX_RECORDS, 1_200),
      1_200,
    ),
  };
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
