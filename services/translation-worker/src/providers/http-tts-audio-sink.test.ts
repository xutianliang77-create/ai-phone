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
          segmentId: "seg_1",
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
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: { audio: { format: "pcm16", sampleRate: 24000, data: "AAE=" } },
    })).rejects.toThrow("HTTP TTS audio sink returned HTTP 422");
  });
});
