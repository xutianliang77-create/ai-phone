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
): AsyncGenerator<ServerRealtimeEvent> {
  if (transcript.isFinal !== false) {
    yield* processFinal(transcript);
    return;
  }
  const text = cleanRealtimeText(transcript.text);
  if (!text || transcript.timing?.overlap === true) return;
  const partial = { ...transcript };
  delete partial.isFinal;
  yield {
    type: "transcript.partial",
    sessionId: session.sessionId,
    ...partial,
    text,
  };
}
