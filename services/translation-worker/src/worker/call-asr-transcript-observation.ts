import type { TranscriptSegment } from "./types.js";

export function observeAsrTranscript(
  transcript: TranscriptSegment | null,
  timing: {
    asrStartedAtMs: number;
    asrFinalAtMs: number;
    processingQueueEnteredAtMs: number;
  },
) {
  if (!transcript) return null;
  return {
    ...transcript,
    pipelineTiming: {
      ...transcript.pipelineTiming,
      ...timing,
    },
  } satisfies TranscriptSegment;
}

export function releaseObservedTranscript(
  transcript: TranscriptSegment,
  processingQueueReleasedAtMs: number,
) {
  return {
    ...transcript,
    pipelineTiming: {
      ...transcript.pipelineTiming,
      processingQueueReleasedAtMs,
    },
  } satisfies TranscriptSegment;
}
