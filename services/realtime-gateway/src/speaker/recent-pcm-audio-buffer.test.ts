import { describe, expect, it } from "vitest";

import { RecentPcmAudioBuffer } from "./recent-pcm-audio-buffer.js";

describe("recent PCM audio buffer", () => {
  it("returns timestamp-preserving clipped frames for a boundary window", () => {
    const buffer = new RecentPcmAudioBuffer();
    buffer.push(frame(1, 1000));
    buffer.push(frame(2, 1100));
    buffer.push(frame(3, 1200));

    const selected = buffer.framesBetween({
      sessionId: "boundary-session",
      startMs: 1050,
      endMs: 1250,
    });

    expect(selected.map((item) => ({
      sequence: item.sequence,
      timestampMs: item.timestampMs,
      bytes: Buffer.from(item.data, "base64").length,
    }))).toEqual([
      { sequence: 1, timestampMs: 1050, bytes: 1600 },
      { sequence: 2, timestampMs: 1100, bytes: 3200 },
      { sequence: 3, timestampMs: 1200, bytes: 1600 },
    ]);
    expect(buffer.latestEndMs()).toBe(1300);
  });
});

function frame(sequence: number, timestampMs: number) {
  return {
    type: "audio.frame" as const,
    sessionId: "sess_1",
    sequence,
    timestampMs,
    format: "pcm16" as const,
    sampleRate: 16000,
    data: Buffer.alloc(3200, sequence).toString("base64"),
  };
}
