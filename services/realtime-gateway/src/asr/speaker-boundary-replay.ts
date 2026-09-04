import type { AudioFrame } from "@translation/contracts";

import { RecentPcmAudioBuffer } from "../speaker/recent-pcm-audio-buffer.js";
import type { TranscriptResult } from "./asr-provider.js";

export function prepareSpeakerBoundaryReplay(
  audio: RecentPcmAudioBuffer,
  input: {
    sessionId: string;
    boundaryMs: number;
    preRollMs: number;
    postRollMs: number;
    minimumAudioMs: number;
  },
) {
  const frames = audio.framesBetween({
    sessionId: input.sessionId,
    startMs: Math.max(0, input.boundaryMs - input.preRollMs),
    endMs: input.boundaryMs + input.postRollMs,
    sequenceBase: replaySequenceBase(input.boundaryMs),
  });
  if (audioDurationMs(frames) < input.minimumAudioMs) return undefined;
  const first = frames[0];
  return {
    ...first,
    data: Buffer.concat(frames.map((frame) =>
      Buffer.from(frame.data, "base64")
    )).toString("base64"),
  };
}

export function selectSpeakerBoundaryWitness(results: TranscriptResult[]) {
  return results.filter((result) =>
    result.isFinal !== false && result.text.trim().length > 0
  ).sort((left, right) =>
    transcriptDurationMs(right) - transcriptDurationMs(left) ||
    Array.from(right.text).length - Array.from(left.text).length
  )[0];
}

export function replayFrameEndMs(frame: AudioFrame) {
  return frame.timestampMs + Buffer.byteLength(frame.data, "base64") / 2 /
    frame.sampleRate * 1000;
}

function replaySequenceBase(boundaryMs: number) {
  return 8_000_000_000_000_000 + Math.round(boundaryMs) % 1_000_000_000 * 1000;
}

function audioDurationMs(frames: AudioFrame[]) {
  return frames.reduce((total, frame) =>
    total + Buffer.byteLength(frame.data, "base64") / 2 /
      frame.sampleRate * 1000, 0);
}

function transcriptDurationMs(transcript: TranscriptResult) {
  return transcript.timing
    ? transcript.timing.endMs - transcript.timing.startMs
    : 0;
}
