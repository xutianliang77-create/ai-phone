import { describe, expect, it, vi } from "vitest";
import { HttpCallTtsTrackAccessClient } from "./call-tts-track-access-client.js";

describe("HttpCallTtsTrackAccessClient", () => {
  it("posts the exact Worker track and target-leg binding", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({
        callId: "call/1",
        status: "authorized",
        targetParticipantIdentity: "call_1:guest:sip:op_1",
        trackSid: "TR_1",
        participantCount: 2,
      }), { status: 200 });
    });
    const client = new HttpCallTtsTrackAccessClient({
      apiBaseUrl: "https://api.example.cn/",
      internalApiSecret: "internal-secret",
      timeoutMs: 1000,
      fetchFn,
    });
    const request = {
      workerIdentity: "call_1:worker:worker-1",
      targetLegId: "call_1:guest:sip:op_1",
      targetSpeakerRole: "guest" as const,
      trackSid: "TR_1",
      trackName: "translation-tts-guest-24000.token",
    };

    await client.authorizeTrack("call/1", request);

    expect(requests[0]?.input).toBe(
      "https://api.example.cn/internal/call-links/call%2F1/tts-track-access",
    );
    expect(requests[0]?.init?.headers).toEqual({
      authorization: "Bearer internal-secret",
      "content-type": "application/json",
    });
    expect(JSON.parse(requests[0]?.init?.body as string)).toEqual(request);
  });

  it("fails closed when subscription isolation is not acknowledged", async () => {
    const client = new HttpCallTtsTrackAccessClient({
      apiBaseUrl: "https://api.example.cn",
      timeoutMs: 1000,
      fetchFn: async () => new Response("{}", { status: 503 }),
    });

    await expect(client.authorizeTrack("call_1", {
      workerIdentity: "call_1:worker:worker-1",
      targetLegId: "call_1:guest:sip:op_1",
      targetSpeakerRole: "guest",
      trackSid: "TR_1",
      trackName: "translation-tts-guest-24000.token",
    })).rejects.toThrow("HTTP 503");
  });

  it("rejects a success response for another target or track", async () => {
    const client = new HttpCallTtsTrackAccessClient({
      apiBaseUrl: "https://api.example.cn",
      timeoutMs: 1000,
      fetchFn: async () => new Response(JSON.stringify({
        callId: "call_1",
        status: "authorized",
        targetParticipantIdentity: "call_1:guest:sip:other",
        trackSid: "TR_1",
        participantCount: 2,
      }), { status: 200 }),
    });
    await expect(client.authorizeTrack("call_1", {
      workerIdentity: "call_1:worker:worker-1",
      targetLegId: "call_1:guest:sip:op_1",
      targetSpeakerRole: "guest",
      trackSid: "TR_1",
      trackName: "translation-tts-guest-24000.token",
    })).rejects.toThrow("invalid binding");
  });
});
