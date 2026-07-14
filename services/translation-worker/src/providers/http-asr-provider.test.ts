import { describe, expect, it } from "vitest";
import { HttpAsrProvider } from "./http-asr-provider.js";

describe("HttpAsrProvider", () => {
  it("uses per-speaker ASR sessions for call room audio", async () => {
    const requests = [];
    const provider = new HttpAsrProvider({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(init?.body as string) });
        return response(200, {
          segmentId: "seg_1",
          text: "hello",
          language: "en",
        });
      }) as typeof fetch,
    });

    const transcript = await provider.transcribe({
      type: "audio.frame",
      sessionId: "call_1",
      speakerRole: "guest",
      sequence: 1,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
    });

    expect(requests[0].url).toBe("http://127.0.0.1:8001/asr/transcribe");
    expect(requests[0].body).toMatchObject({
      sessionId: "call_1:guest",
      sourceLanguage: "auto",
      targetLanguage: "zh",
      mode: "call_link",
    });
    expect(transcript).toMatchObject({ segmentId: "seg_1", text: "hello" });
  });

  it("flushes the matching speaker ASR session", async () => {
    const requests = [];
    const provider = new HttpAsrProvider({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(init?.body as string) });
        return response(200, {
          segmentId: "flush_1",
          text: "你好",
          language: "zh",
        });
      }) as typeof fetch,
    });

    await provider.flush("call_1", "host");

    expect(requests[0]).toEqual({
      url: "http://127.0.0.1:8001/asr/sessions/call_1%3Ahost/flush",
      body: {
        sourceLanguage: "auto",
        targetLanguage: "zh",
        mode: "call_link",
        hotwords: [],
        corrections: [],
      },
    });
  });

  it("sends domain hints and preserves endpoint metadata", async () => {
    const requests = [];
    const provider = new HttpAsrProvider({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      hotwords: ["Hy-MT2"],
      corrections: [{ fromText: "会议既要", toText: "会议纪要" }],
      fetchFn: (async (_url: string, init?: RequestInit) => {
        requests.push(JSON.parse(init?.body as string));
        return response(200, {
          segmentId: "seg_2",
          text: "会议纪要",
          language: "zh",
          endpointReason: "max_duration",
          timing: { startMs: 0, endMs: 10000, source: "model" },
          vadContext: { speechMs: 9200, silenceMs: 800 },
        });
      }) as typeof fetch,
    });

    const transcript = await provider.transcribe({
      type: "audio.frame",
      sessionId: "call_2",
      speakerRole: "host",
      sequence: 2,
      timestampMs: 2,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
    });

    expect(requests[0]).toMatchObject({
      hotwords: ["Hy-MT2"],
      corrections: [{ fromText: "会议既要", toText: "会议纪要" }],
    });
    expect(transcript).toMatchObject({
      endpointReason: "max_duration",
      timing: { startMs: 0, endMs: 10000, source: "model" },
    });
  });

  it("uses the PSTN endpoint policy when configured", async () => {
    const requests = [];
    const provider = new HttpAsrProvider({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      endpointMode: "pstn",
      timeoutMs: 100,
      fetchFn: (async (_url: string, init?: RequestInit) => {
        requests.push(JSON.parse(init?.body as string));
        return response(204);
      }) as typeof fetch,
    });

    await provider.transcribe({
      type: "audio.frame",
      sessionId: "pstn_1",
      speakerRole: "host",
      sequence: 1,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 16000,
      data: "AA==",
    });

    expect(requests[0].mode).toBe("pstn");
  });

  it("forwards MarbleNet frame VAD decisions even without a transcript", async () => {
    const decisions: unknown[] = [];
    const provider = new HttpAsrProvider({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async () => response(204, undefined, {
        "x-asr-vad-voiced": "true",
        "x-asr-vad-provider": "marblenet",
        "x-asr-vad-sequence": "7",
        "x-asr-vad-timestamp-ms": "1000",
        "x-asr-vad-duration-ms": "100",
        "x-asr-vad-probability": "0.82",
        "x-asr-vad-preroll-ms": "400",
        "x-asr-vad-fallback": "false",
      })) as typeof fetch,
    });
    provider.setVadDecisionSink((decision) => decisions.push(decision));

    await provider.transcribe({
      type: "audio.frame",
      sessionId: "call_vad",
      speakerRole: "guest",
      sequence: 7,
      timestampMs: 1000,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
    });

    expect(decisions).toEqual([{
      callId: "call_vad",
      speakerRole: "guest",
      sequence: 7,
      timestampMs: 1000,
      durationMs: 100,
      voiced: true,
      probability: 0.82,
      provider: "marblenet",
      fallback: false,
      preRollMs: 400,
    }]);
  });

  it("treats null and invalid confidence as unknown", async () => {
    for (const confidence of [null, -0.1, 1.1]) {
      const provider = new HttpAsrProvider({
        endpoint: "http://127.0.0.1:8001/asr/transcribe",
        timeoutMs: 100,
        fetchFn: (async () => response(200, {
          segmentId: "seg_confidence",
          text: "hello",
          language: "en",
          confidence,
        })) as typeof fetch,
      });

      expect(await provider.transcribe({
        type: "audio.frame",
        sessionId: "call_confidence",
        speakerRole: "guest",
        sequence: 1,
        timestampMs: 1,
        format: "pcm16",
        sampleRate: 24000,
        data: "AA==",
      })).not.toHaveProperty("confidence");
    }
  });
});

function response(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as Response;
}
