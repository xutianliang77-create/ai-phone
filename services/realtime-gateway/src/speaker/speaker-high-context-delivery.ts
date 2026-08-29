import type { ServerRealtimeEvent } from "@translation/contracts";
import type { TranscriptResult } from "../asr/asr-provider.js";
import type {
  RealtimeProviderSession,
} from "../providers/realtime-provider.js";

export function protectedTermsFor(session: RealtimeProviderSession) {
  return [...new Set([
    ...(session.asrHotwords ?? []),
    ...(session.asrCorrections ?? []).flatMap((item) => [
      item.fromText,
      item.toText,
    ]),
    ...(session.terminology ?? []).flatMap((term) => [
      term.sourceText,
      term.translatedText,
    ]),
  ].map((item) => item.trim()).filter(Boolean))];
}

export function assertCompleteSplitDelivery(
  transcripts: TranscriptResult[],
  events: ServerRealtimeEvent[],
) {
  if (events.some((event) =>
    event.type === "error" || event.type === "translation.failed"
  )) throw new Error("Split transcript translation failed");
  const finalIds = new Set(events.flatMap((event) =>
    event.type === "transcript.final" ? [event.segmentId] : []
  ));
  const translationIds = new Set(events.flatMap((event) =>
    event.type === "translation.final" ? [event.segmentId] : []
  ));
  if (transcripts.some((transcript) =>
    !finalIds.has(transcript.segmentId) ||
    !translationIds.has(transcript.segmentId)
  )) throw new Error("Split transcript translation was incomplete");
}
