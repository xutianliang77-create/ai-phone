import { describe, expect, it } from "vitest";
import { HttpTtsProvider } from "./http-tts-provider.js";

describe("HttpTtsProvider", () => {
  it("submits translated text to an HTTP TTS endpoint", async () => {
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      apiKey: "tts-secret",
      timeoutMs: 1000,
      fetchFn: async (url, init) => {
        expect(url).toBe("https://tts.example.com/synthesize");
        expect(init?.headers).toMatchObject({ authorization: "Bearer tts-secret" });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          text: "你好",
          language: "zh",
          speakerRole: "guest",
          segmentId: "seg_1",
        });
        return response(200, {
          provider: "qwen3-tts",
          model: "qwen3-tts-0.6b",
          firstAudioMs: 180,
          audioDurationMs: 1200,
          audio: {
            format: "pcm16",
            sampleRate: 24000,
            data: "AAE=",
          },
        });
      },
    });

    await expect(provider.synthesize({
      text: "你好",
      language: "zh",
      speakerRole: "guest",
      segmentId: "seg_1",
      signal: new AbortController().signal,
    })).resolves.toEqual({
      provider: "qwen3-tts",
      model: "qwen3-tts-0.6b",
      firstAudioMs: 180,
      audioDurationMs: 1200,
      audio: {
        format: "pcm16",
        sampleRate: 24000,
        data: "AAE=",
      },
    });
  });

  it("submits configured voice simulation settings to HTTP TTS", async () => {
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      timeoutMs: 1000,
      provider: "voxcpm2",
      model: "VoxCPM2",
      voice: {
        mode: "personal_clone",
        voiceProfileId: "my_voice",
        referenceAudioId: "my_voice",
        controlPrompt: "clear and calm",
      },
      fetchFn: async (_url, init) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          text: "你好",
          voice: {
            mode: "personal_clone",
            voiceProfileId: "my_voice",
            referenceAudioId: "my_voice",
            controlPrompt: "clear and calm",
          },
        });
        return response(200, {
          provider: "voxcpm2",
          model: "VoxCPM2",
          voiceMode: "personal_clone",
          voiceProfileId: "my_voice",
          audio: {
            format: "pcm16",
            sampleRate: 24000,
            data: "AAE=",
          },
        });
      },
    });

    await expect(provider.synthesize({
      text: "你好",
      language: "zh",
      speakerRole: "guest",
      segmentId: "seg_1",
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      provider: "voxcpm2",
      model: "VoxCPM2",
      voiceMode: "personal_clone",
      voiceProfileId: "my_voice",
    });
  });

  it("treats 204 as no synthesized speech", async () => {
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      timeoutMs: 1000,
      fetchFn: async () => new Response(null, { status: 204 }),
    });

    await expect(provider.synthesize({
      text: "hello",
      language: "en",
      speakerRole: "host",
      segmentId: "seg_1",
      signal: new AbortController().signal,
    })).resolves.toBeNull();
  });

  it("uses configured VoxCPM2 identity when the service omits metadata", async () => {
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      timeoutMs: 1000,
      provider: "voxcpm2",
      model: "VoxCPM2",
      fetchFn: async () => response(200, {
        firstAudioMs: 22,
        audio: {
          format: "pcm16",
          sampleRate: 16000,
          data: "AAE=",
        },
      }),
    });

    await expect(provider.synthesize({
      text: "See you tomorrow.",
      language: "en",
      speakerRole: "guest",
      segmentId: "seg_1",
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      provider: "voxcpm2",
      model: "VoxCPM2",
      firstAudioMs: 22,
    });
  });

  it("rejects TTS responses from an unexpected configured model", async () => {
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      timeoutMs: 1000,
      provider: "voxcpm2",
      model: "VoxCPM2",
      fetchFn: async () => response(200, {
        provider: "qwen3-tts",
        model: "qwen3-tts-0.6b",
        audio: {
          format: "pcm16",
          sampleRate: 16000,
          data: "AAE=",
        },
      }),
    });

    await expect(provider.synthesize({
      text: "hello",
      language: "en",
      speakerRole: "host",
      segmentId: "seg_1",
      signal: new AbortController().signal,
    })).rejects.toThrow("HTTP TTS returned unexpected provider: qwen3-tts");
  });

  it("rejects successful responses without playable PCM audio", async () => {
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      timeoutMs: 1000,
      fetchFn: async () => response(200, {
        provider: "voxcpm2",
        model: "VoxCPM2",
        audio: {
          format: "wav",
          sampleRate: 48000,
          data: "AAE=",
        },
      }),
    });

    await expect(provider.synthesize({
      text: "hello",
      language: "en",
      speakerRole: "host",
      segmentId: "seg_1",
      signal: new AbortController().signal,
    })).rejects.toThrow("HTTP TTS returned no playable PCM audio");
  });

  it("propagates pipeline cancellation to the active HTTP request", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null = null;
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      timeoutMs: 1000,
      fetchFn: async (_url, init) => {
        requestSignal = init?.signal as AbortSignal;
        return await new Promise<Response>((_resolve, reject) =>
          requestSignal!.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")), { once: true })
        );
      },
    });

    const pending = provider.synthesize({
      text: "你好",
      language: "zh",
      speakerRole: "guest",
      segmentId: "seg_1",
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
  });
});

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
