import { describe, expect, it } from "vitest";
import { HttpTtsAudioSink } from "./http-tts-audio-sink.js";

describe("HttpTtsAudioSink", () => {
  it("posts synthesized PCM audio to the configured sink", async () => {
    const sink = new HttpTtsAudioSink({
      endpoint: "https://media.example.cn/tts-playback",
      apiKey: "sink-secret",
      timeoutMs: 1000,
      fetchFn: async (url, init) => {
        expect(url).toBe("https://media.example.cn/tts-playback");
        expect(init?.headers).toMatchObject({ authorization: "Bearer sink-secret" });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          callId: "call_1",
          sessionId: "call_1",
          segmentId: "seg_1",
          playbackId: "pb_1",
          generation: 1,
          sourceLegId: "host-leg",
          targetLegId: "guest-leg",
          sourceSpeakerRole: "host",
          targetSpeakerRole: "guest",
          language: "en",
          provider: "qwen3-tts",
          model: "qwen3-tts-0.6b",
          audio: {
            format: "pcm16",
            sampleRate: 24000,
            data: "AAE=",
          },
        });
        return new Response(null, { status: 204 });
      },
    });

    await sink.play({
      callId: "call_1",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: {
        provider: "qwen3-tts",
        model: "qwen3-tts-0.6b",
        firstAudioMs: 120,
        audioDurationMs: 900,
        audio: {
          format: "pcm16",
          sampleRate: 24000,
          data: "AAE=",
        },
      },
      signal: new AbortController().signal,
    });
  });

  it("fails when the playback endpoint rejects audio", async () => {
    const sink = new HttpTtsAudioSink({
      endpoint: "https://media.example.cn/tts-playback",
      timeoutMs: 1000,
      fetchFn: async () => new Response("bad audio", { status: 422 }),
    });

    await expect(sink.play({
      callId: "call_1",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: { audio: { format: "pcm16", sampleRate: 24000, data: "AAE=" } },
      signal: new AbortController().signal,
    })).rejects.toThrow("HTTP TTS audio sink returned HTTP 422");
  });

  it("uses the configured leg-bound interrupt endpoint", async () => {
    const sink = new HttpTtsAudioSink({
      endpoint: "https://media.example.cn/translated-audio",
      interruptEndpoint:
        "https://media.example.cn/internal/calls/:callId/playbacks/:playbackId/interrupt",
      timeoutMs: 1000,
      fetchFn: async (url, init) => {
        expect(url).toBe(
          "https://media.example.cn/internal/calls/call_1/playbacks/pb_1/interrupt",
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          sessionId: "call_1",
          targetLegId: "guest-leg",
          generation: 2,
          reason: "barge_in",
          idempotencyKey: "interrupt:pb_1:2",
        });
        return Response.json({ cleared: true });
      },
    });

    await expect(sink.interrupt({
      callId: "call_1",
      playbackId: "pb_1",
      generation: 2,
      targetLegId: "guest-leg",
      targetSpeakerRole: "guest",
      reason: "barge_in",
      idempotencyKey: "interrupt:pb_1:2",
    })).resolves.toEqual({ cleared: true });
  });

  it("does not send audio when the playback was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const sink = new HttpTtsAudioSink({
      endpoint: "https://media.example.cn/tts-playback",
      timeoutMs: 1000,
      fetchFn: async (_url, init) => {
        expect(init?.signal?.aborted).toBe(true);
        throw init?.signal?.reason ?? new DOMException("aborted", "AbortError");
      },
    });

    await expect(sink.play({
      callId: "call_1",
      segmentId: "seg_1",
      playbackId: "pb_1",
      generation: 1,
      sourceLegId: "host-leg",
      targetLegId: "guest-leg",
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: { audio: { format: "pcm16", sampleRate: 24000, data: "AAE=" } },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
