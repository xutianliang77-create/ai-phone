import type { ServerRealtimeEvent } from "@translation/contracts";
import type { TranscriptResult } from "../../asr/asr-provider.js";
import { cleanRealtimeText } from "../../protocol/realtime-text.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";


export async function* routeAsrTranscript(
  session: RealtimeProviderSession,
  transcript: TranscriptResult,
  processFinal: (
    transcript: TranscriptResult,
  ) => AsyncGenerator<ServerRealtimeEvent>,
  rewritePartial: (transcript: TranscriptResult) => TranscriptResult =
    (transcript) => transcript,
): AsyncGenerator<ServerRealtimeEvent> {
  if (transcript.isFinal !== false) {
    yield* processFinal(transcript);
    return;
  }
  const rewritten = rewritePartial(transcript);
  const text = cleanRealtimeText(rewritten.text);
  if (!text || rewritten.timing?.overlap === true) return;
  const partial = { ...rewritten };
  delete partial.isFinal;
  yield {
    type: "transcript.partial",
    sessionId: session.sessionId,
    ...partial,
    text,
  };
}
