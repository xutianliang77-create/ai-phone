import { describe, expect, it } from "vitest";
import { pcm16SignalSummary } from "./audio-frame-logger.js";

describe("PCM signal diagnostics", () => {
  it("summarizes signal energy without retaining audio content", () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(1000, 0);
    pcm.writeInt16LE(-2000, 2);
    pcm.writeInt16LE(0, 4);
    pcm.writeInt16LE(3000, 6);
    expect(pcm16SignalSummary(pcm.toString("base64"))).toEqual({
      sampleCount: 4,
      peakAbs: 3000,
      rms: 1871,
      nonzeroPermille: 750,
    });
  });

  it("rejects malformed or non-PCM diagnostic input safely", () => {
    expect(pcm16SignalSummary("not-base64")).toEqual({
      sampleCount: 0,
      peakAbs: 0,
      rms: 0,
      nonzeroPermille: 0,
    });
  });
});
