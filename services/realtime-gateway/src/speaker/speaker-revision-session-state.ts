import { SpeakerRevisionAudioBuffer } from "./speaker-revision-audio-buffer.js";
import {
  type StoredTranscriptFinal,
} from "./speaker-high-context-token-split.js";

export type SpeakerRevisionMode = "shadow" | "apply";


export interface RevisionSessionState {
  generation: number;
  enabled: boolean;
  audio: SpeakerRevisionAudioBuffer;
  segments: Map<string, RevisionTranscriptRecord>;
  protectedTerms: string[];
  diagnostics: {
    requestCount: number;
    completedCount: number;
    acceptedCount: number;
    emittedUpdateCount: number;
    errorCount: number;
    staleResultCount: number;
    splitParentCount: number;
    splitChildCount: number;
    splitRejectedCount: number;
    splitSkippedParentCount: number;
    splitSkippedReasonCounts: Record<string, number>;
    cardinalityMismatchCount: number;
    lastLatencyMs?: number;
  };
}


export type RevisionTranscriptRecord = StoredTranscriptFinal & {
  speakerRevision?: number;
};
