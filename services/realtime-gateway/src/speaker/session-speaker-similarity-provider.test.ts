import { describe, expect, it, vi } from "vitest";
import { HttpSessionSpeakerSimilarityProvider } from "./session-speaker-similarity-provider.js";

describe("HTTP session speaker similarity provider", () => {
  it("sends anonymous session evidence and parses similarities", async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(200, {
      rawSpeakerId: "speaker_2",
      evidenceMs: 1600,
      eligible: true,
      similarities: {
        speaker_1: 0.6326,
        invalid: 2,
      },
    }));
    const provider = new HttpSessionSpeakerSimilarityProvider({
      baseUrl: "http://127.0.0.1:8022/",
      apiKey: "secret",
      timeoutMs: 2000,
      fetchFn,
    });

    const result = await provider.observe({
      sessionId: "sess_1",
      rawSpeakerId: "speaker_2",
      audioBase64: "d2F2",
      overlap: false,
    });

    expect(result).toEqual({
      rawSpeakerId: "speaker_2",
      evidenceMs: 1600,
      eligible: true,
      similarities: { speaker_1: 0.6326 },
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:8022/speaker/sessions/sess_1/aliases/observe",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rawSpeakerId: "speaker_2",
          audioBase64: "d2F2",
          overlap: false,
        }),
      }),
    );
  });

  it("rejects malformed responses instead of creating aliases", async () => {
    const provider = new HttpSessionSpeakerSimilarityProvider({
      baseUrl: "http://127.0.0.1:8022",
      timeoutMs: 2000,
      fetchFn: vi.fn().mockResolvedValue(response(200, {
        rawSpeakerId: "speaker_2",
        evidenceMs: -1,
        eligible: true,
        similarities: {},
      })),
    });

    await expect(provider.observe({
      sessionId: "sess_1",
      rawSpeakerId: "speaker_2",
      audioBase64: "d2F2",
      overlap: false,
    })).rejects.toThrow("invalid response");
  });
});

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
