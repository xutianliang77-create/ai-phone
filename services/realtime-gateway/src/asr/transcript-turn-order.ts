import type { TranscriptResult } from "./asr-provider.js";

export function orderedTurnTranscripts(
  transcripts: TranscriptResult[],
): TranscriptResult[] {
  const latestBySegment = new Map<string, TranscriptResult>();
  for (const transcript of transcripts) {
    const current = latestBySegment.get(transcript.segmentId);
    if (!current || (transcript.revision ?? 0) >= (current.revision ?? 0)) {
      latestBySegment.set(transcript.segmentId, transcript);
    }
  }
  return [...latestBySegment.values()].sort((left, right) =>
    (left.timing?.startMs ?? Number.MAX_SAFE_INTEGER) -
      (right.timing?.startMs ?? Number.MAX_SAFE_INTEGER) ||
    (left.timing?.endMs ?? Number.MAX_SAFE_INTEGER) -
      (right.timing?.endMs ?? Number.MAX_SAFE_INTEGER) ||
    left.segmentId.localeCompare(right.segmentId)
  );
}
