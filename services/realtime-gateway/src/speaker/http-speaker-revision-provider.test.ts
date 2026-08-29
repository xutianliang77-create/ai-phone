import { afterEach, describe, expect, it } from "vitest";
import { HttpSpeakerRevisionProvider } from
  "./http-speaker-revision-provider.js";
import type { SpeakerRevisionRequest } from
  "./speaker-revision-provider.js";

describe("HTTP speaker revision provider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("accepts a request-correlated bounded response", async () => {
    globalThis.fetch = async (_input, init) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer revision-key",
      });
      return Response.json({
        sessionId: "sess_1",
        generation: 2,
        windowStartMs: 1000,
        windowEndMs: 3000,
        provider: "moss_transcribe_diarize",
        model: "MOSS-Transcribe-Diarize-0.9B",
        speakerCount: 2,
        spans: [
          { speakerId: "S01", startMs: 0, endMs: 900 },
          { speakerId: "S02", startMs: 1000, endMs: 2000 },
        ],
        latencyMs: 420,
      });
    };
    const provider = new HttpSpeakerRevisionProvider({
      endpoint: "http://127.0.0.1:8122/revision",
      apiKey: "revision-key",
      timeoutMs: 1000,
    });

    await expect(provider.revise(request())).resolves.toMatchObject({
      sessionId: "sess_1",
      generation: 2,
      speakerCount: 2,
      spans: [{ speakerId: "S01" }, { speakerId: "S02" }],
    });
  });

  it("rejects stale generations and malformed spans", async () => {
    globalThis.fetch = async () => Response.json({
      sessionId: "sess_1",
      generation: 1,
      windowStartMs: 1000,
      windowEndMs: 3000,
      provider: "moss_transcribe_diarize",
      speakerCount: 1,
      spans: [{ speakerId: "S01", startMs: 20, endMs: 10 }],
    });
    const provider = new HttpSpeakerRevisionProvider({
      endpoint: "http://127.0.0.1:8122/revision",
      timeoutMs: 1000,
    });

    await expect(provider.revise(request())).rejects.toThrow(
      /malformed|match/,
    );
  });

  it("rejects unbounded or unsafe provider metadata", async () => {
    globalThis.fetch = async () => Response.json({
      sessionId: "sess_1",
      generation: 2,
      windowStartMs: 1000,
      windowEndMs: 3000,
      provider: "moss\nforged-log-line",
      speakerCount: 1,
      spans: [{ speakerId: "S01", startMs: 0, endMs: 2000 }],
    });
    const provider = new HttpSpeakerRevisionProvider({
      endpoint: "http://127.0.0.1:8122/revision",
      timeoutMs: 1000,
    });

    await expect(provider.revise(request())).rejects.toThrow(/match/);
  });
});

function request(): SpeakerRevisionRequest {
  return {
    sessionId: "sess_1",
    generation: 2,
    windowStartMs: 1000,
    windowEndMs: 3000,
    sampleRate: 16000,
    audioPcm16: "AAAA",
  };
}
