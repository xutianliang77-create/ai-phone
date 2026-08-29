import { describe, expect, it } from "vitest";
import { SpeakerRevisionAudioBuffer } from
  "./speaker-revision-audio-buffer.js";

describe("speaker revision audio buffer", () => {
  it("keeps a bounded trailing PCM window and resets on sample-rate changes", () => {
    const buffer = new SpeakerRevisionAudioBuffer(2000);
    buffer.push(frame(1, 0, 16000));
    buffer.push(frame(2, 1000, 16000));
    buffer.push(frame(3, 2000, 16000));

    expect(buffer.snapshot("sess_1", 2)).toMatchObject({
      sessionId: "sess_1",
      generation: 2,
      windowStartMs: 1000,
      windowEndMs: 3000,
      sampleRate: 16000,
    });

    buffer.push(frame(4, 3000, 24000));
    expect(buffer.snapshot("sess_1", 2)).toMatchObject({
      windowStartMs: 3000,
      windowEndMs: 4000,
      sampleRate: 24000,
    });
  });

  it("bounds one oversized frame and ignores unsupported sample rates", () => {
    const buffer = new SpeakerRevisionAudioBuffer(2000);
    buffer.push(frame(1, 0, 16000, 3));

    expect(buffer.snapshot("sess_1", 1)).toMatchObject({
      windowStartMs: 1000,
      windowEndMs: 3000,
      sampleRate: 16000,
    });

    buffer.push(frame(2, 3000, 48000));
    expect(buffer.snapshot("sess_1", 1)).toMatchObject({
      windowStartMs: 1000,
      windowEndMs: 3000,
    });
  });

  it("keeps the last authoritative speech checkpoint through trailing silence", () => {
    const buffer = new SpeakerRevisionAudioBuffer(2000);
    buffer.push(frame(1, 0, 16000));
    buffer.push(frame(2, 1000, 16000));
    buffer.checkpoint(2000);

    buffer.push(frame(3, 2000, 16000));
    buffer.push(frame(4, 3000, 16000));
    buffer.push(frame(5, 4000, 16000));

    expect(buffer.snapshot("sess_1", 1)).toMatchObject({
      windowStartMs: 0,
      windowEndMs: 2000,
      sampleRate: 16000,
    });
  });
});

function frame(
  sequence: number,
  timestampMs: number,
  sampleRate: number,
  seconds = 1,
) {
  return {
    type: "audio.frame" as const,
    sessionId: "sess_1",
    sequence,
    timestampMs,
    format: "pcm16" as const,
    sampleRate,
    data: Buffer.alloc(sampleRate * 2 * seconds).toString("base64"),
  };
}
