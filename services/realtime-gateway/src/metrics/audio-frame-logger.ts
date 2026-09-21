import type { AudioFrame } from "@translation/contracts";
import { realtimeLogger } from "./realtime-metrics.js";

const frameCounts = new Map<string, number>();

/** Non-content diagnostic only. It never retains PCM, text, or a waveform. */
export function pcm16SignalSummary(data: string) {
  try {
    const pcm = Buffer.from(data, "base64");
    if (!pcm.length || pcm.length % 2 || pcm.toString("base64") !== data) {
      return { sampleCount: 0, peakAbs: 0, rms: 0, nonzeroPermille: 0 };
    }
    let peakAbs = 0, sumSquares = 0, nonzero = 0;
    for (let offset = 0; offset < pcm.length; offset += 2) {
      const sample = pcm.readInt16LE(offset);
      const absolute = Math.abs(sample);
      peakAbs = Math.max(peakAbs, absolute);
      sumSquares += sample * sample;
      if (sample !== 0) nonzero += 1;
    }
    const sampleCount = pcm.length / 2;
    return {
      sampleCount,
      peakAbs,
      rms: Math.round(Math.sqrt(sumSquares / sampleCount)),
      nonzeroPermille: Math.round(nonzero * 1000 / sampleCount),
    };
  } catch {
    return { sampleCount: 0, peakAbs: 0, rms: 0, nonzeroPermille: 0 };
  }
}

export function logAudioFrameReceived(frame: AudioFrame) {
  const count = (frameCounts.get(frame.sessionId) ?? 0) + 1;
  frameCounts.set(frame.sessionId, count);
  if (count !== 1 && count % 25 !== 0) return;

  realtimeLogger.info({
    sessionId: frame.sessionId,
    count,
    sequence: frame.sequence,
    sampleRate: frame.sampleRate,
    payloadBase64Length: frame.data.length,
    signal: pcm16SignalSummary(frame.data),
  }, "Realtime audio frame received");
}

export function clearAudioFrameLog(sessionId: string) {
  frameCounts.delete(sessionId);
}
