import { describe, expect, it } from "vitest";
import { HttpTtsProvider } from "./http-tts-provider.js";

describe("HttpTtsProvider streaming", () => {
  it("parses ordered NDJSON PCM chunks from the streaming endpoint", async () => {
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      streamEndpoint: "https://tts.example.com/stream",
      timeoutMs: 1000,
      fetchFn: async (url) => {
        expect(url).toBe("https://tts.example.com/stream");
        return new Response([
          JSON.stringify({
            type: "metadata",
            provider: "voxcpm2",
            model: "VoxCPM2",
            firstAudioMs: 210,
            audioDurationMs: 400,
          }),
          JSON.stringify({
            type: "audio_chunk",
            sequence: 1,
            format: "pcm16",
            sampleRate: 24000,
            data: "AAE=",
          }),
          JSON.stringify({
            type: "audio_chunk",
            sequence: 2,
            format: "pcm16",
            sampleRate: 24000,
            data: "AgM=",
          }),
          JSON.stringify({ type: "final" }),
        ].join("\n") + "\n", {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        });
      },
    });

    const events = [];
    for await (const event of provider.synthesizeStream!({
      text: "你好",
      language: "zh",
      speakerRole: "guest",
      segmentId: "seg_stream",
      signal: new AbortController().signal,
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "metadata",
      "audio_chunk",
      "audio_chunk",
      "final",
    ]);
  });

  it("keeps the timeout active while the streaming body is stalled", async () => {
    let requestSignal: AbortSignal | null = null;
    const provider = new HttpTtsProvider({
      endpoint: "https://tts.example.com/synthesize",
      streamEndpoint: "https://tts.example.com/stream",
      timeoutMs: 20,
      fetchFn: async (_url, init) => {
        requestSignal = init?.signal as AbortSignal;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(
              `${JSON.stringify({
                type: "metadata",
                provider: "voxcpm2",
                model: "VoxCPM2",
              })}\n`,
            ));
          },
        }));
      },
    });

    const consume = async () => {
      for await (const _event of provider.synthesizeStream!({
        text: "你好",
        language: "zh",
        speakerRole: "guest",
        segmentId: "seg_stalled",
        signal: new AbortController().signal,
      })) {
        // Consume until the provider times out the stalled response body.
      }
    };

    await expect(consume()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(requestSignal?.aborted).toBe(true);
  });
});
