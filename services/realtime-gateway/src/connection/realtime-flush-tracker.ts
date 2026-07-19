import type {
  RealtimeFlushSummary,
  ServerRealtimeEvent,
  TranscriptEvent,
  TranslationEvent,
  TranslationFailedEvent,
} from "@translation/contracts";

interface SegmentOutcome {
  transcriptFinal: boolean;
  translationFinal: boolean;
  translationFailed: boolean;
}

type SegmentOutcomeEvent =
  | TranscriptEvent
  | TranslationEvent
  | TranslationFailedEvent;

export class RealtimeFlushTracker {
  private readonly segments = new Map<string, SegmentOutcome>();
  private flushSegmentIds = new Set<string>();
  private pipelineErrorCount = 0;
  private finalizing = false;

  record(event: ServerRealtimeEvent) {
    if (event.type === "error") {
      if (this.finalizing) this.pipelineErrorCount += 1;
      return;
    }
    if (!isSegmentOutcomeEvent(event)) return;

    const outcome = this.segments.get(event.segmentId) ?? emptyOutcome();
    if (event.type === "transcript.final") outcome.transcriptFinal = true;
    if (event.type === "translation.final") {
      outcome.translationFinal = true;
      outcome.translationFailed = false;
    }
    if (event.type === "translation.failed" && !outcome.translationFinal) {
      outcome.translationFailed = true;
    }
    this.segments.set(event.segmentId, outcome);
    if (this.finalizing) this.flushSegmentIds.add(event.segmentId);
  }

  beginFinalization() {
    if (this.finalizing) return;
    this.finalizing = true;
    this.pipelineErrorCount = 0;
    this.flushSegmentIds = new Set(
      [...this.segments.entries()]
        .filter(([, outcome]) => isUnresolved(outcome))
        .map(([segmentId]) => segmentId),
    );
  }

  summarize(steps: { audioFlushed: boolean; providerFlushed: boolean }) {
    this.finalizing = false;
    let transcriptFinalCount = 0;
    let translationFinalCount = 0;
    let translationFailedCount = 0;
    let unresolvedSegmentCount = 0;
    for (const segmentId of this.flushSegmentIds) {
      const outcome = this.segments.get(segmentId) ?? emptyOutcome();
      if (outcome.transcriptFinal) transcriptFinalCount += 1;
      if (outcome.translationFinal) translationFinalCount += 1;
      if (outcome.translationFailed) translationFailedCount += 1;
      if (isUnresolved(outcome)) unresolvedSegmentCount += 1;
    }

    const degraded = !steps.audioFlushed ||
      !steps.providerFlushed ||
      this.pipelineErrorCount > 0 ||
      translationFailedCount > 0 ||
      unresolvedSegmentCount > 0;
    const empty = this.flushSegmentIds.size === 0 && !degraded;
    return {
      status: degraded ? "degraded" : empty ? "empty" : "completed",
      transcriptFinalCount,
      translationFinalCount,
      translationFailedCount,
      unresolvedSegmentCount,
      pipelineErrorCount: this.pipelineErrorCount,
      ...steps,
    } satisfies RealtimeFlushSummary;
  }
}

function emptyOutcome(): SegmentOutcome {
  return {
    transcriptFinal: false,
    translationFinal: false,
    translationFailed: false,
  };
}

function isUnresolved(outcome: SegmentOutcome) {
  return outcome.transcriptFinal &&
    !outcome.translationFinal &&
    !outcome.translationFailed;
}

function isSegmentOutcomeEvent(
  event: ServerRealtimeEvent,
): event is SegmentOutcomeEvent {
  return event.type === "transcript.final" ||
    event.type === "translation.final" ||
    event.type === "translation.failed";
}
