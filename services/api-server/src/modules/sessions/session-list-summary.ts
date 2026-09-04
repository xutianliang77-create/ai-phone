import type { SessionRecord } from "./session-record.js";
import { orderSessionSegmentsChronologically } from
  "./session-segment-order.js";

const TITLE_MAX_LENGTH = 36;

export function sessionListSummary(session: SessionRecord) {
  const segments = orderSessionSegmentsChronologically(session.segments);
  const firstSegment = segments.find((segment) =>
    Boolean(segment.sourceText.trim() || segment.translatedText.trim()));
  const speakers = new Set(
    segments
      .map((segment) => segment.speaker?.speakerId.trim())
      .filter((speakerId): speakerId is string =>
        speakerId !== undefined && speakerId.length > 0 &&
        speakerId.toLowerCase() !== "unknown"
      ),
  );
  return {
    kind: sessionKind(session),
    ...(sessionTitle(session, firstSegment) ? {
      title: sessionTitle(session, firstSegment),
    } : {}),
    ...(firstSegment?.sourceLanguage ? {
      sourceLanguage: firstSegment.sourceLanguage,
    } : {}),
    ...(firstSegment?.targetLanguage ? {
      targetLanguage: firstSegment.targetLanguage,
    } : {}),
    speakerCount: speakers.size,
  };
}

function sessionKind(session: SessionRecord): "realtime" | "call" | "scan" {
  if (session.segments.some((segment) => segment.provider === "scan")) {
    return "scan";
  }
  if (session.mode === "call_link" ||
      session.segments.some((segment) => segment.provider === "type_to_speak")) {
    return "call";
  }
  return "realtime";
}

function sessionTitle(
  session: SessionRecord,
  firstSegment: SessionRecord["segments"][number] | undefined,
) {
  const title = session.review?.title?.trim() ||
    firstSegment?.sourceText.trim() ||
    firstSegment?.translatedText.trim() ||
    "";
  if (title.length <= TITLE_MAX_LENGTH) return title;
  return `${title.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}
