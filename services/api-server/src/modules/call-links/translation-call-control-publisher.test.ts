import { describe, expect, it, vi } from "vitest";
import { DataPacket_Kind } from "livekit-server-sdk";
import { TranslationCallControlPublisher } from
  "./translation-call-control-publisher.js";

describe("translation call control publisher", () => {
  it("targets only the exact call, agent kind, and dispatch generation", async () => {
    const sendData = vi.fn(async (
      _roomName: string,
      _data: Uint8Array,
      _kind: DataPacket_Kind,
      _options: { topic: string; destinationIdentities: string[] },
    ) => undefined);
    const publisher = new TranslationCallControlPublisher(config, {
      listParticipants: vi.fn(async () => [
        participant("translation-call-1-g7", "call-2", 7),
        participant("translation-call-1-g7", "call-1", 7, "voice_agent"),
        {
          ...participant("translation-call-1-g7", "call-1", 7),
          attributes: {
            ...participant("translation-call-1-g7", "call-1", 7).attributes,
            "translation.sessionId": "call-2",
          },
        },
        participant("translation-call-1-g6", "call-1", 6),
        participant("translation-call-1-g7", "call-1", 7),
      ]),
      sendData,
    });

    await publisher.publish("call_call-1", command());

    expect(sendData).toHaveBeenCalledOnce();
    expect(sendData.mock.calls[0]?.[3]).toMatchObject({
      destinationIdentities: ["translation-call-1-g7"],
    });
  });

  it("fails closed when more than one exact worker is present", async () => {
    const publisher = new TranslationCallControlPublisher(config, {
      listParticipants: vi.fn(async () => [
        participant("translation-call-1-g7", "call-1", 7),
        participant("translation-call-1-g7", "call-1", 7),
      ]),
      sendData: vi.fn(async () => undefined),
    });

    await expect(publisher.publish("call_call-1", command())).rejects
      .toMatchObject({ workerCount: 2 });
  });
});

const config = {
  livekitUrl: "wss://livekit.example.test",
  apiKey: "test-key",
  apiSecret: "test-secret",
};

function participant(
  identity: string,
  callId: string,
  generation: number,
  agentKind = "call_translation",
) {
  return {
    identity,
    metadata: JSON.stringify({
      participantRole: "worker",
      callId,
      sessionId: callId,
      agentKind,
      dispatchGeneration: generation,
    }),
    attributes: {
      "translation.role": "worker",
      "translation.callId": callId,
      "translation.sessionId": callId,
      "translation.agentKind": agentKind,
      "translation.generation": String(generation),
    },
  };
}

function command() {
  return {
    version: 1 as const,
    type: "translation.uplink_pause" as const,
    callId: "call-1",
    dialOperationId: "dial-1",
    controlOperationId: "control-1",
    dispatchGeneration: 7,
    controlGeneration: 2,
    paused: true,
    issuedAt: "2026-08-13T08:00:00.000Z",
    expiresAt: "2026-08-13T08:00:30.000Z",
  };
}
