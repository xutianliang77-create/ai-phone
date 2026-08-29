import type { AudioFrame } from "@translation/contracts";
import type { SpeakerRevisionRequest } from "./speaker-revision-provider.js";

interface BufferedFrame {
  timestampMs: number;
  durationMs: number;
  sampleRate: number;
  pcm: Buffer;
}

export class SpeakerRevisionAudioBuffer {
  private readonly frames: BufferedFrame[] = [];
  private checkpointFrames: BufferedFrame[] = [];

  constructor(private readonly maxDurationMs: number) {}

  push(frame: AudioFrame) {
    if (
      frame.format !== "pcm16" ||
      ![16_000, 24_000].includes(frame.sampleRate) ||
      !Number.isFinite(frame.timestampMs) ||
      frame.timestampMs < 0
    ) return;
    let pcm = Buffer.from(frame.data, "base64");
    if (pcm.length === 0 || pcm.length % 2 !== 0) return;
    let durationMs = pcm.length / 2 / frame.sampleRate * 1000;
    let timestampMs = frame.timestampMs;
    if (durationMs > this.maxDurationMs) {
      const boundedSamples = Math.max(
        1,
        Math.floor(frame.sampleRate * this.maxDurationMs / 1000),
      );
      const endMs = timestampMs + durationMs;
      pcm = pcm.subarray(Math.max(0, pcm.length - boundedSamples * 2));
      durationMs = pcm.length / 2 / frame.sampleRate * 1000;
      timestampMs = endMs - durationMs;
      this.clear();
    }
    const previous = this.frames.at(-1);
    if (previous && previous.sampleRate !== frame.sampleRate) this.clear();
    this.frames.push({
      timestampMs,
      durationMs,
      sampleRate: frame.sampleRate,
      pcm,
    });
    this.trim();
  }

  snapshot(sessionId: string, generation: number) {
    const frames = this.checkpointFrames.length > 0
      ? this.checkpointFrames
      : this.frames;
    if (frames.length === 0) return null;
    const first = frames[0];
    const last = frames.at(-1)!;
    const pcm = Buffer.concat(frames.map((frame) => frame.pcm));
    if (pcm.length / 2 / first.sampleRate * 1000 < 1_000) return null;
    return {
      sessionId,
      generation,
      windowStartMs: first.timestampMs,
      windowEndMs: last.timestampMs + last.durationMs,
      sampleRate: first.sampleRate,
      audioPcm16: pcm.toString("base64"),
    } satisfies SpeakerRevisionRequest;
  }

  clear() {
    this.frames.length = 0;
    this.checkpointFrames = [];
  }

  checkpoint(endMs: number | undefined) {
    if (!Number.isFinite(endMs)) return;
    const frames = this.frames.filter((frame) => frame.timestampMs < endMs!);
    if (frames.length === 0) return;
    const durationMs = frames.reduce(
      (total, frame) => total + frame.durationMs,
      0,
    );
    if (durationMs < 1_000) return;
    this.checkpointFrames = [...frames];
  }

  private trim() {
    let durationMs = this.frames.reduce(
      (total, frame) => total + frame.durationMs,
      0,
    );
    while (this.frames.length > 1 && durationMs > this.maxDurationMs) {
      durationMs -= this.frames.shift()!.durationMs;
    }
  }
}
