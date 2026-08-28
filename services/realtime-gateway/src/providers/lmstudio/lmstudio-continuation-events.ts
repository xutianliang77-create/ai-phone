import type { ServerRealtimeEvent } from "@translation/contracts";
import type { TranscriptResult } from "../../asr/asr-provider.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";

export function continuationTombstones(
  session: RealtimeProviderSession,
  transcript: TranscriptResult,
  segmentIds: string[] | undefined,
): ServerRealtimeEvent[] {
  return (segmentIds ?? []).map((segmentId) => ({
    type: "transcript.final",
    sessionId: session.sessionId,
    segmentId,
    turnId: transcript.turnId,
    revision: transcript.revision,
    text: "",
    language: transcript.language,
  }));
}
