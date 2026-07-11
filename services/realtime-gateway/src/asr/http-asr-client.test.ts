import { describe, expect, it } from "vitest";
import { HttpAsrClient } from "./http-asr-client.js";

describe("http asr client", () => {
  it("posts audio frames to the configured asr endpoint", async () => {
    const requests = [];
    const client = new HttpAsrClient({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      apiKey: "test-key",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          authorization: init?.headers?.["authorization"],
          body: JSON.parse(init?.body as string),
        });
        return response(200, {
          segmentId: "seg_1",
          text: "hello",
          language: "en",
          confidence: 0.88,
        });
      }) as typeof fetch,
    });

    const transcript = await client.transcribe({
      sessionId: "sess_1",
      sequence: 1,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(requests[0].url).toBe("http://127.0.0.1:8001/asr/transcribe");
    expect(requests[0].authorization).toBe("Bearer test-key");
    expect(requests[0].body.sampleRate).toBe(24000);
    expect(transcript).toEqual({
      segmentId: "seg_1",
      text: "hello",
      language: "en",
      confidence: 0.88,
    });
  });

  it("passes ASR hotwords and correction terms to the service", async () => {
    const requests = [];
    const client = new HttpAsrClient({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async (_url: string, init?: RequestInit) => {
        requests.push({ body: JSON.parse(init?.body as string) });
        return response(200, {
          segmentId: "seg_1",
          text: "我们要测试 Qwen3 ASR 和 Hy-MT2",
          language: "zh",
        });
      }) as typeof fetch,
    });

    await client.transcribe({
      sessionId: "sess_1",
      sequence: 1,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
      sourceLanguage: "zh",
      targetLanguage: "en",
      hotwords: ["Qwen3 ASR", "Hy-MT2", "筑基丹"],
      corrections: [{ fromText: "助机单", toText: "筑基丹" }],
    });

    expect(requests[0].body.hotwords).toEqual(["Qwen3 ASR", "Hy-MT2", "筑基丹"]);
    expect(requests[0].body.corrections).toEqual([{ fromText: "助机单", toText: "筑基丹" }]);
  });

  it("returns null when the asr service has no transcript yet", async () => {
    const client = new HttpAsrClient({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async () => response(204)) as typeof fetch,
    });

    const transcript = await client.transcribe({
      sessionId: "sess_1",
      sequence: 1,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(transcript).toBeNull();
  });

  it("returns null for ASR silence markers", async () => {
    const client = new HttpAsrClient({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async () =>
        response(200, {
          segmentId: "sil_1",
          text: "<sil>",
          language: "en",
        })) as typeof fetch,
    });

    const transcript = await client.transcribe({
      sessionId: "sess_1",
      sequence: 1,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(transcript).toBeNull();
  });

  it("strips ASR markers from mixed transcripts", async () => {
    const client = new HttpAsrClient({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async () =>
        response(200, {
          segmentId: "mix_1",
          text: "hello <|nospeech|> world",
          language: "en",
        })) as typeof fetch,
    });

    const transcript = await client.transcribe({
      sessionId: "sess_1",
      sequence: 1,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(transcript?.text).toBe("hello world");
  });

  it("accepts Hy-MT translation language codes from ASR", async () => {
    const client = new HttpAsrClient({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async () =>
        response(200, {
          segmentId: "seg_ja",
          text: "こんにちは",
          language: "ja",
        })) as typeof fetch,
    });

    const transcript = await client.transcribe({
      sessionId: "sess_1",
      sequence: 1,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });

    expect(transcript?.language).toBe("ja");
  });

  it("posts session flush requests to the derived flush endpoint", async () => {
    const requests = [];
    const client = new HttpAsrClient({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          body: JSON.parse(init?.body as string),
        });
        return response(200, {
          segmentId: "flush_7",
          text: "tail audio",
          language: "en",
        });
      }) as typeof fetch,
    });

    const transcript = await client.flush({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    expect(requests[0].url).toBe(
      "http://127.0.0.1:8001/asr/sessions/sess_1/flush",
    );
    expect(requests[0].body).toEqual({
      sourceLanguage: "en",
      targetLanguage: "zh",
    });
    expect(transcript?.segmentId).toBe("flush_7");
  });

  it("closes remote ASR sessions", async () => {
    const requests = [];
    const client = new HttpAsrClient({
      endpoint: "http://127.0.0.1:8001/asr/transcribe",
      apiKey: "test-key",
      timeoutMs: 100,
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          method: init?.method,
          authorization: init?.headers?.["authorization"],
        });
        return response(204);
      }) as typeof fetch,
    });

    await client.closeSession("sess_1");

    expect(requests[0]).toEqual({
      url: "http://127.0.0.1:8001/asr/sessions/sess_1",
      method: "DELETE",
      authorization: "Bearer test-key",
    });
  });
});

function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
