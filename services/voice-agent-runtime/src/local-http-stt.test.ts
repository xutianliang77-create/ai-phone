import { initializeLogger, stt as livekitStt } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { describe, expect, it, vi } from "vitest";
import { LocalHttpSTT } from "./local-http-stt.js";

initializeLogger({ pretty: false, level: "silent" });

describe("LocalHttpSTT", () => {
  it("rechunks ten 20 ms RTC frames into one lossless 200 ms ASR request", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/asr/transcribe")) {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(null, {
          status: 204,
          headers: { "x-asr-vad-voiced": "true" },
        });
      }
      if (url.includes("/flush")) {
        return jsonResponse({
          segmentId: "segment-1",
          isFinal: true,
          text: "你好",
          language: "zh",
          confidence: 0.98,
          endpointReason: "flush",
        });
      }
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected request ${init?.method} ${url}`);
    });
    const stt = new LocalHttpSTT({
      baseUrl: "http://asr.local/",
      apiKey: "asr-secret",
      language: "zh",
      model: "local/qwen3-asr-1.7b",
      timeoutMs: 1000,
      fetchFn,
    });
    const stream = stt.stream();
    const inputFrames = Array.from({ length: 10 }, (_, index) =>
      new AudioFrame(new Int16Array(320).fill(index + 1), 16_000, 1, 320));
    for (const frame of inputFrames) stream.pushFrame(frame);
    stream.endInput();

    const events = [];
    for await (const event of stream) events.push(event);

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request).toMatchObject({
      sequence: 1,
      timestampMs: 0,
      format: "pcm16",
      sampleRate: 16_000,
      sourceLanguage: "zh",
      targetLanguage: "zh",
      mode: "pstn",
    });
    const actualPcm = Buffer.from(String(request.data), "base64");
    const expectedPcm = Buffer.concat(inputFrames.map((frame) =>
      Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)));
    expect(actualPcm).toHaveLength(6400);
    expect(actualPcm.equals(expectedPcm)).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      livekitStt.SpeechEventType.START_OF_SPEECH,
      livekitStt.SpeechEventType.FINAL_TRANSCRIPT,
      livekitStt.SpeechEventType.END_OF_SPEECH,
      livekitStt.SpeechEventType.RECOGNITION_USAGE,
    ]);
    expect(events[1]?.alternatives?.[0]?.text).toBe("你好");
    expect(events[2]?.alternatives).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledWith(
      "http://asr.local/asr/transcribe",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer asr-secret",
        }),
      }),
    );
  });
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
