import { describe, expect, it } from "vitest";
import { fromTelephonyMulaw8k, toTelephonyMulaw8k } from "./audio-codec.js";
import type { TtsAudioSinkRequest } from "./types.js";

describe("PSTN audio codec", () => {
  it("converts 16 kHz PCM16 audio to 8 kHz mu-law", () => {
    const payload = toTelephonyMulaw8k(audioRequest({
      sampleRate: 16000,
      samples: [0, 0, 1000, -1000],
    }));

    expect(payload).toEqual({
      encoding: "mulaw8k",
      sampleRate: 8000,
      durationMs: 0,
      data: "/84=",
    });
  });

  it("converts 24 kHz PCM16 audio to 8 kHz mu-law", () => {
    const payload = toTelephonyMulaw8k(audioRequest({
      sampleRate: 24000,
      samples: [0, 100, 200, -300, -200, -100],
    }));

    expect(payload.encoding).toBe("mulaw8k");
    expect(payload.sampleRate).toBe(8000);
    expect(Buffer.from(payload.data, "base64")).toHaveLength(2);
  });

  it("converts 8 kHz mu-law media frames to 16 kHz PCM16 audio", () => {
    const payload = fromTelephonyMulaw8k({
      callId: "call-1",
      mediaStreamId: "stream-1",
      sourceSpeakerRole: "guest",
      sequence: 1,
      audio: {
        encoding: "mulaw8k",
        sampleRate: 8000,
        durationMs: 1,
        data: "/w==",
      },
    });

    expect(payload).toEqual({
      format: "pcm16",
      sampleRate: 16000,
      data: "AAAAAA==",
    });
  });
});

function audioRequest(options: {
  sampleRate: 16000 | 24000;
  samples: number[];
}): TtsAudioSinkRequest {
  const buffer = Buffer.alloc(options.samples.length * 2);
  options.samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, index * 2);
  });
  return {
    callId: "call-1",
    segmentId: "seg-1",
    sourceSpeakerRole: "host",
    targetSpeakerRole: "guest",
    language: "en",
    audio: {
      format: "pcm16",
      sampleRate: options.sampleRate,
      data: buffer.toString("base64"),
    },
  };
}
