import { describe, expect, it } from "vitest";
import { estimateFrequency } from "./livekit_duplex_playback_audio.mjs";

describe("LiveKit duplex playback probe metrics", () => {
  it.each([440, 660, 880])("estimates a %i Hz PCM frame", (frequency) => {
    const sampleRate = 16000;
    const samples = new Int16Array(sampleRate / 10);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.round(
        Math.sin(2 * Math.PI * frequency * index / sampleRate) * 9000,
      );
    }

    expect(Math.abs(estimateFrequency(samples, sampleRate) - frequency)).toBeLessThanOrEqual(5);
  });
});
