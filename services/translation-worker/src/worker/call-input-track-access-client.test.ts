import { describe, expect, it, vi } from "vitest";
import { HttpCallInputTrackAccessClient } from
  "./call-input-track-access-client.js";

describe("call input track access client", () => {
  it("authorizes one exact worker, participant, and track binding", async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({
        callId: "call-1",
        status: "authorized",
        speakerRole: "guest",
        participantIdentity: "call-1:guest:air:air-780-1",
        trackSid: "TR_air_1",
      }),
      { status: 200 },
    ));
    const client = new HttpCallInputTrackAccessClient({
      apiBaseUrl: "https://api.example.cn/",
      internalApiSecret: "internal-secret",
      timeoutMs: 1_000,
      fetchFn,
    });
    const request = {
      workerIdentity: "call-1:worker:translation-1",
      dispatchGeneration: 7,
      participantIdentity: "call-1:guest:air:air-780-1",
      trackSid: "TR_air_1",
      trackName: "air780-downlink-air-780-1",
    };

    await expect(client.authorizeTrack("call-1", request))
      .resolves.toEqual({ speakerRole: "guest" });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.example.cn/internal/call-links/call-1/input-track-access",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer internal-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      }),
    );
  });

  it.each([
    JSON.stringify({ callId: "call-1", status: "authorized",
      speakerRole: "worker", participantIdentity: "guest-1", trackSid: "TR_1" }),
    JSON.stringify({ callId: "call-1", status: "authorized",
      speakerRole: "guest", participantIdentity: "guest-1", trackSid: "TR_1",
      extra: true }),
    "not-json",
  ])("fails closed on invalid admission response %s", async (body) => {
    const client = new HttpCallInputTrackAccessClient({
      apiBaseUrl: "https://api.example.cn",
      timeoutMs: 1_000,
      fetchFn: async () => new Response(body, { status: 200 }),
    });
    await expect(client.authorizeTrack("call-1", {
      workerIdentity: "worker-1",
      participantIdentity: "guest-1",
      trackSid: "TR_1",
      trackName: "microphone",
    })).rejects.toThrow();
  });
});
