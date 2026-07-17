import { describe, expect, it, vi } from "vitest";
import { LiveKitTtsTrackAccessController } from "./livekit-tts-track-access.js";
import type { LiveKitRoomConfig } from "./call-room-readiness.js";

describe("LiveKitTtsTrackAccessController", () => {
  it("subscribes only the exact target before TTS frames are emitted", async () => {
    const client = fakeClient();
    const controller = new LiveKitTtsTrackAccessController(config(), client);

    const result = await controller.authorize({
      roomName: "call_1",
      workerIdentity: "call_1:worker:worker-1",
      targetLegId: "call_1:guest:sip:op_1",
      trackSid: "TR_1",
      trackName: "translation-tts-guest-24000.token",
    });

    expect(result).toEqual({ participantCount: 3 });
    expect(client.updateSubscriptions.mock.calls).toEqual(expect.arrayContaining([
      ["call_1", "call_1:host:host-1", ["TR_1"], false],
      ["call_1", "call_1:guest:sip:op_1", ["TR_1"], true],
      ["call_1", "call_1:guest:web-1", ["TR_1"], false],
    ]));
  });

  it("fails before changing subscriptions when the Worker track is not bound", async () => {
    const client = fakeClient();
    const controller = new LiveKitTtsTrackAccessController(config(), client);

    await expect(controller.authorize({
      roomName: "call_1",
      workerIdentity: "call_1:worker:worker-1",
      targetLegId: "call_1:guest:sip:op_1",
      trackSid: "TR_tampered",
      trackName: "translation-tts-guest-24000.token",
    })).rejects.toThrow("binding not found");
    expect(client.updateSubscriptions).not.toHaveBeenCalled();
  });
});

function fakeClient() {
  return {
    listParticipants: vi.fn(async () => [
      {
        identity: "call_1:worker:worker-1",
        tracks: [{
          sid: "TR_1",
          name: "translation-tts-guest-24000.token",
        }],
      },
      { identity: "call_1:host:host-1", tracks: [] },
      { identity: "call_1:guest:sip:op_1", tracks: [] },
      { identity: "call_1:guest:web-1", tracks: [] },
    ]),
    updateSubscriptions: vi.fn(async () => {}),
  };
}

function config(): LiveKitRoomConfig {
  return {
    livekitUrl: "wss://livekit.example.cn",
    apiKey: "key",
    apiSecret: "secret",
    tokenTtlSeconds: 120,
    resourceLimits: {
      maxParticipants: 4,
      maxSessionSeconds: 3600,
      maxDataPacketBytes: 12000,
      maxEventsPerRequest: 20,
      emptyTimeoutSeconds: 60,
      guestTicketTtlSeconds: 120,
      maxEventRequestsPerSecond: 40,
      maxParticipantNameCharacters: 80,
    },
  };
}
