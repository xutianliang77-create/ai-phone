import type { AudioFrame, SegmentTimingDto } from "@translation/contracts";

interface BufferedFrame {
  timestampMs: number;
  durationMs: number;
  sampleRate: number;
  pcm: Buffer;
}

export class RecentPcmAudioBuffer {
  private readonly frames: BufferedFrame[] = [];

  push(frame: AudioFrame) {
    if (frame.format !== "pcm16") return;
    const pcm = Buffer.from(frame.data, "base64");
    if (pcm.length === 0 || pcm.length % 2 !== 0) return;
    const durationMs = pcm.length / 2 / frame.sampleRate * 1000;
    this.frames.push({
      timestampMs: frame.timestampMs,
      durationMs,
      sampleRate: frame.sampleRate,
      pcm,
    });
    const cutoff = frame.timestampMs - 8_000;
    while (this.frames[0] && this.frames[0].timestampMs < cutoff) {
      this.frames.shift();
    }
  }

  wavBase64(timing?: SegmentTimingDto) {
    const matching = timing
      ? this.frames.filter((frame) => intersects(frame, timing))
      : [];
    const selected = matching.length > 0 ? matching : trailing(this.frames, 5_000);
    if (selected.length === 0) return null;
    const sampleRate = selected[0].sampleRate;
    const compatible = selected.filter((frame) => frame.sampleRate === sampleRate);
    const pcm = Buffer.concat(compatible.map((frame) => frame.pcm));
    const durationMs = pcm.length / 2 / sampleRate * 1000;
    if (durationMs < 1_500) return null;
    return wav(pcm, sampleRate).toString("base64");
  }

  clear() {
    this.frames.length = 0;
  }
}

function intersects(frame: BufferedFrame, timing: SegmentTimingDto) {
  const end = frame.timestampMs + frame.durationMs;
  return frame.timestampMs < timing.endMs && end > timing.startMs;
}

function trailing(frames: BufferedFrame[], maxDurationMs: number) {
  const selected: BufferedFrame[] = [];
  let duration = 0;
  for (let index = frames.length - 1; index >= 0 && duration < maxDurationMs; index--) {
    selected.unshift(frames[index]);
    duration += frames[index].durationMs;
  }
  return selected;
}

function wav(pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
