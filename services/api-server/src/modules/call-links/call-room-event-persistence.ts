import { upsertSegment } from "../sessions/sessions-runtime.repository.js";
import type { CallLinkRecord } from "./call-links.service.js";
import type { CallRoomDataEvent } from "./call-room-events.js";
import {
  applyCallBargeInEvent,
  applyCallPlaybackEvent,
} from "./call-playbacks.repository.js";

export async function persistCallRoomDataEvent(
  record: CallLinkRecord,
  event: CallRoomDataEvent,
) {
  if (event.type === "worker.status") return null;
  if (event.type.startsWith("playback.")) {
    return applyCallPlaybackEvent(record.sessionId, event);
  }
  if (event.type.startsWith("barge_in.")) {
    return applyCallBargeInEvent(record.sessionId, event);
  }
  if (event.type.startsWith("pipeline.")) {
    return null;
  }
  return await upsertSegment(record.sessionId, {
    segmentId: event.segmentId,
    speechId: event.speechId,
    turnId: event.turnId,
    revision: event.revision,
    pipelineGeneration: event.pipelineGeneration,
    pipelineTiming: event.pipelineTiming,
    sourceText: event.sourceText ?? (
      event.type === "transcript.final" ? event.text : undefined
    ),
    rawText: event.rawText,
    optimizedText: event.optimizedText,
    translatedText: event.translatedText ?? (
      event.type === "translation.final" ? event.text : undefined
    ),
    confidence: event.confidence,
    refinement: event.refinement,
    speaker: event.speaker,
    timing: event.timing ?? {
      startMs: event.timestampMs,
      endMs: event.timestampMs,
      source: "participant_track",
    },
  });
}
