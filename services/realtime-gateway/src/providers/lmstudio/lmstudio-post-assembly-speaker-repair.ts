import type { AsrProvider, TranscriptResult } from
  "../../asr/asr-provider.js";
import { realtimeLogger } from "../../metrics/realtime-metrics.js";
import { protectedTermsFor } from
  "../../speaker/speaker-high-context-delivery.js";
import { reconcileRealtimeSpeakerTokenBoundaries } from
  "../../speaker/speaker-realtime-token-reconciliation.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";

export function repairPostAssemblySpeakerBoundaries(
  asr: AsrProvider,
  session: RealtimeProviderSession,
  transcripts: TranscriptResult[],
) {
  if (!asr.speakerBoundaryEvidence || !asr.resolveSpeakerBoundaries) {
    return transcripts;
  }
  const repaired: TranscriptResult[] = [];
  for (const transcript of transcripts) {
    const evidence = asr.speakerBoundaryEvidence(session.sessionId);
    if (!evidence || evidence.boundaries.length === 0) {
      repaired.push(transcript);
      continue;
    }
    const confirmedSpeakerIds = new Set(evidence.confirmedSpeakerIds);
    const result = reconcileRealtimeSpeakerTokenBoundaries({
      transcripts: [transcript],
      boundaries: evidence.boundaries,
      spans: evidence.spans,
      isConfirmedSpeakerId: (speakerId) =>
        confirmedSpeakerIds.has(speakerId),
      protectedTerms: protectedTermsFor(session),
    });
    if (result.resolvedBoundaryMs.length > 0) {
      asr.resolveSpeakerBoundaries(
        session.sessionId,
        result.resolvedBoundaryMs,
      );
    }
    logSkippedParents(session.sessionId, result.skippedParents);
    repaired.push(...result.transcripts);
  }
  return repaired;
}

function logSkippedParents(
  sessionId: string,
  skipped: ReturnType<
    typeof reconcileRealtimeSpeakerTokenBoundaries
  >["skippedParents"],
) {
  if (skipped.length === 0) return;
  realtimeLogger.info({
    sessionId,
    skippedParentCount: skipped.length,
    skippedParents: skipped.map((item) => ({
      segmentId: item.segmentId,
      boundaryMs: item.boundaryMs,
      reason: item.reason,
    })),
  }, "Post-assembly token-timing speaker split kept fail-closed");
}
