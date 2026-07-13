import type { CallRoomSubmittedEvent } from "@translation/contracts";
import type { CallTranscriptRefiner } from "./call-transcript-refiner.js";
import type { TranscriptSegment } from "./types.js";

type RefinedTranscript = Awaited<ReturnType<CallTranscriptRefiner["refine"]>>;

export function callRecognitionMetadata(
  transcript: TranscriptSegment,
  refined: RefinedTranscript | undefined,
): Pick<
  CallRoomSubmittedEvent,
  "rawText" | "optimizedText" | "confidence" | "refinement" | "timing"
> {
  return {
    rawText: refined?.rawText ?? transcript.text,
    optimizedText: refined?.text ?? transcript.text,
    ...(transcript.confidence === undefined
      ? {}
      : { confidence: transcript.confidence }),
    ...(refined?.refinement ? { refinement: refined.refinement } : {}),
    ...(transcript.timing ? { timing: transcript.timing } : {}),
  };
}
