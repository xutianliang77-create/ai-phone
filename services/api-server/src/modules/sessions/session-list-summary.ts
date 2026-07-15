import type { SessionRecord } from "./session-record.js";

const TITLE_MAX_LENGTH = 36;

export function sessionListSummary(session: SessionRecord) {
  const firstSegment = session.segments.find((segment) =>
    Boolean(segment.sourceText.trim() || segment.translatedText.trim()));
  const speakers = new Set(
    session.segments
      .map((segment) => segment.speaker?.speakerId)
      .filter((speakerId): speakerId is string => Boolean(speakerId)),
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
