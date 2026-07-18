import { describe, expect, it, vi } from "vitest";
import { prewarmTranslationAgentTts } from "./translation-agent-tts-prewarm.js";

describe("prewarmTranslationAgentTts", () => {
  it("skips nodes without an HTTP TTS endpoint", async () => {
    await expect(prewarmTranslationAgentTts(baseEnv({
      ttsHttpEndpoint: undefined,
    }))).resolves.toEqual({
      status: "skipped",
      reason: "tts_unconfigured",
    });
  });

  it("requires a real playable synthesis before reporting ready", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        text: "准备就绪",
        language: "zh",
        speakerRole: "host",
        segmentId: "agent-node-prewarm",
        speechId: "speech:agent-node-prewarm",
        turnId: "turn:agent-node-prewarm",
        revision: 1,
        pipelineGeneration: 1,
      });
      return response(200, {
        provider: "voxcpm2",
        model: "VoxCPM2",
        firstAudioMs: 32100,
        audio: {
          format: "pcm16",
          sampleRate: 24000,
          data: "AAE=",
        },
      });
    });

    await expect(prewarmTranslationAgentTts(baseEnv(), {
      fetchFn,
    })).resolves.toMatchObject({
      status: "ready",
      firstAudioMs: 32100,
      provider: "voxcpm2",
      model: "VoxCPM2",
      audioBytes: 2,
      sampleRate: 24000,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("fails closed when synthesis does not return playable PCM", async () => {
    await expect(prewarmTranslationAgentTts(baseEnv(), {
      fetchFn: async () => response(200, {
        provider: "voxcpm2",
        model: "VoxCPM2",
        audio: {
          format: "wav",
          sampleRate: 48000,
          data: "AAE=",
        },
      }),
    })).rejects.toThrow("HTTP TTS returned no playable PCM audio");
  });
});

function baseEnv(overrides: Record<string, unknown> = {}) {
  return {
    ttsHttpEndpoint: "https://tts.example.com/synthesize",
    ttsHttpApiKey: "tts-secret",
    ttsAgentPrewarmTimeoutMs: 60000,
    ttsProvider: "voxcpm2",
    ttsModel: "VoxCPM2",
    ttsVoice: undefined,
    ...overrides,
  };
}

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
