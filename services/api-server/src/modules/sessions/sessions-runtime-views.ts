import type { SpeakerAttributionDto } from "@translation/contracts";
import type { SessionRecord } from "./session-record.js";

export function sessionMatchesQuery(session: SessionRecord, query: string) {
  if (!query) return true;
  return [session.id, session.mode, session.status, session.createdAt,
    session.endedAt ?? "", ...session.segments.flatMap((segment) => [
      segment.sourceText, segment.rawText ?? "", segment.optimizedText ?? "",
      segment.translatedText,
    ])].some((value) => value.toLowerCase().includes(query));
}

export function sessionSpeakerSummary(session: SessionRecord) {
  const speakers = new Map<string, {
    speaker: SpeakerAttributionDto;
    segmentCount: number;
    totalDurationMs: number;
  }>();
  for (const segment of session.segments) {
    if (!segment.speaker) continue;
    const value = speakers.get(segment.speaker.speakerId) ?? {
      speaker: segment.speaker, segmentCount: 0, totalDurationMs: 0,
    };
    value.segmentCount += 1;
    value.totalDurationMs += segment.timing
      ? Math.max(0, segment.timing.endMs - segment.timing.startMs) : 0;
    if (segment.speaker.displayName) value.speaker = segment.speaker;
    speakers.set(segment.speaker.speakerId, value);
  }
  return [...speakers.values()];
}
