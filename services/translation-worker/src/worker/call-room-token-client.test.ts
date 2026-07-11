import { describe, expect, it } from "vitest";
import { HttpCallRoomTokenClient } from "./call-room-token-client.js";

describe("HttpCallRoomTokenClient", () => {
  it("requests worker room tokens from the internal API", async () => {
    const requests = [];
    const client = new HttpCallRoomTokenClient({
      apiBaseUrl: "http://127.0.0.1:3100/",
      internalApiSecret: "internal-secret",
      timeoutMs: 100,
      participantName: "worker-1",
      fetchFn: (async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          authorization: init?.headers?.["authorization"],
          body: JSON.parse(init?.body as string),
        });
        return response(200, {
          callId: "call_1",
          sessionId: "call_1",
          provider: "livekit",
          roomName: "call_call_1",
          wsUrl: "wss://livekit.example.cn",
          participantRole: "worker",
          token: "worker-token",
          expiresAt: "2026-07-03T00:00:00.000Z",
          ttsVoice: {
            mode: "personal_clone",
            voiceProfileId: "voice-profile-1",
            referenceAudioId: "voice-profile-1",
          },
        });
      }) as typeof fetch,
    });

    const token = await client.createWorkerToken("call_1");

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:3100/internal/call-links/call_1/worker-room-token",
        authorization: "Bearer internal-secret",
        body: { participantName: "worker-1" },
      },
    ]);
    expect(token).toMatchObject({
      participantRole: "worker",
      token: "worker-token",
      ttsVoice: {
        mode: "personal_clone",
        voiceProfileId: "voice-profile-1",
        referenceAudioId: "voice-profile-1",
      },
    });
  });

  it("throws when the internal token API rejects the request", async () => {
    const client = new HttpCallRoomTokenClient({
      apiBaseUrl: "http://127.0.0.1:3100",
      timeoutMs: 100,
      participantName: "worker-1",
      fetchFn: (async () => response(401, {})) as typeof fetch,
    });

    await expect(client.createWorkerToken("call_1")).rejects.toThrow(
      "Worker room token API returned HTTP 401",
    );
  });
});

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}
