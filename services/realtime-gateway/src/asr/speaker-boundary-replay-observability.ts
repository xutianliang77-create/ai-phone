import { createHash } from "node:crypto";
import type { AudioFrame } from "@translation/contracts";

import { realtimeLogger } from "../metrics/realtime-metrics.js";

export function logSpeakerBoundaryReplay(
  sessionId: string,
  boundaryMs: number,
  frame: AudioFrame,
) {
  const pcm = Buffer.from(frame.data, "base64");
  const durationMs = pcm.length / 2 / frame.sampleRate * 1000;
  realtimeLogger.info({
    sessionId,
    boundaryMs,
    replayStartMs: frame.timestampMs,
    replayEndMs: frame.timestampMs + durationMs,
    replayBytes: pcm.length,
    replayPcmSha256: createHash("sha256").update(pcm).digest("hex"),
  }, "Speaker boundary witness replay prepared");
}
