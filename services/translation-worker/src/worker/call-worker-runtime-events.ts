import {
  participantTrackSpeaker,
  type CallRoomSubmittedEvent,
} from "@translation/contracts";
import type { CallDuplexConfig } from "./types.js";

export const disabledCallDuplexConfig: CallDuplexConfig = {
  enabled: false,
  minSpeechMs: 240,
  minProbability: 0.5,
  cooldownMs: 800,
  preRollMs: 400,
};

export function callWorkerStatusEvent(
  segmentId: string,
  text: string,
  timestampMs: number,
  diagnostics: Pick<
    CallRoomSubmittedEvent,
    "stage" | "provider" | "model" | "retryable"
  > = {},
): CallRoomSubmittedEvent {
  return {
    type: "worker.status",
    segmentId,
    speakerRole: "worker",
    speaker: participantTrackSpeaker("worker"),
    sourceLanguage: "en",
    targetLanguage: "zh",
    text,
    ...diagnostics,
    timestampMs,
  };
}
