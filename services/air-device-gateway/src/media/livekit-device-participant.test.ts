import { describe, expect, it, vi } from "vitest";
import {
  AirDeviceLiveKitParticipant,
  airDeviceParticipantProfile,
} from "./livekit-device-participant.js";

describe("Air device LiveKit guest participant", () => {
  it("keeps the existing host/guest/worker model with explicit Air attributes", () => {
    expect(airDeviceParticipantProfile({
      communicationSessionId: "session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
    })).toEqual({
      identity: "session-1:guest:air:air-001",
      attributes: {
        "ai.phone.call_id": "session-1",
        "ai.phone.communication_session_id": "session-1",
        "ai.phone.participant_role": "guest",
        "ai.phone.transport": "air780",
        "ai.phone.device_id": "air-001",
        "ai.phone.lease_id": "lease-1",
        "ai.phone.call_generation": "3",
      },
    });
  });

  it("publishes only device downlink and subscribes only to exact target TTS", async () => {
    const room = {
      connect: vi.fn().mockResolvedValue(undefined),
      publishPcmTrack: vi.fn().mockResolvedValue(undefined),
      setSubscribed: vi.fn().mockResolvedValue(undefined),
    };
    const participant = new AirDeviceLiveKitParticipant({
      room,
      communicationSessionId: "session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "translation_isolated",
      token: "signed-token",
      wsUrl: "wss://livekit.example.cn",
    });
    await participant.connect();
    await participant.publishDownlink(new Int16Array(160), 8_000);
    await participant.handleRemoteTrack({
      sid: "raw-host",
      name: "host-microphone",
      publisherIdentity: "session-1:host:app",
    });
    const target = Buffer.from("session-1:guest:air:air-001").toString("base64url");
    await participant.handleRemoteTrack({
      sid: "tts-guest",
      name: `translation-tts-guest-24000.${target}`,
      publisherIdentity: "session-1:worker:translation",
      admission: {
        uplinkSource: "translated_tts",
        trackSid: "tts-guest",
        trackName: `translation-tts-guest-24000.${target}`,
        publisherIdentity: "session-1:worker:translation",
        communicationSessionId: "session-1",
        targetParticipantIdentity: "session-1:guest:air:air-001",
        deviceId: "air-001",
        leaseId: "lease-1",
        callGeneration: 3,
      },
    });

    expect(room.connect).toHaveBeenCalledWith(
      "wss://livekit.example.cn",
      "signed-token",
      {
        autoSubscribe: false,
        communicationSessionId: "session-1",
        mediaPolicy: "translation_isolated",
      },
    );
    expect(room.publishPcmTrack).toHaveBeenCalledWith(
      "air780-downlink-air-001",
      expect.any(Int16Array),
      8_000,
    );
    expect(room.setSubscribed).toHaveBeenNthCalledWith(1, "raw-host", false);
    expect(room.setSubscribed).toHaveBeenNthCalledWith(2, "tts-guest", true);
  });

  it("subscribes to TTS published by the LiveKit Agent identity", async () => {
    const room = {
      connect: vi.fn().mockResolvedValue(undefined),
      publishPcmTrack: vi.fn().mockResolvedValue(undefined),
      setSubscribed: vi.fn().mockResolvedValue(undefined),
    };
    const participant = new AirDeviceLiveKitParticipant({
      room,
      communicationSessionId: "a550dd47-c54e-4fce-b7c0-27e66b5dc5ef",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "translation_isolated",
      token: "signed-token",
      wsUrl: "wss://livekit.example.cn",
    });
    const target = Buffer.from(
      "a550dd47-c54e-4fce-b7c0-27e66b5dc5ef:guest:air:air-001",
    ).toString("base64url");
    const trackName = `translation-tts-guest-24000.${target}`;
    const publisherIdentity = "translation-a550dd47-c54-g1";

    await expect(participant.handleRemoteTrack({
      sid: "tts-agent",
      name: trackName,
      publisherIdentity,
      admission: {
        uplinkSource: "translated_tts",
        trackSid: "tts-agent",
        trackName,
        publisherIdentity,
        communicationSessionId: "a550dd47-c54e-4fce-b7c0-27e66b5dc5ef",
        targetParticipantIdentity:
          "a550dd47-c54e-4fce-b7c0-27e66b5dc5ef:guest:air:air-001",
        deviceId: "air-001",
        leaseId: "lease-1",
        callGeneration: 3,
      },
    })).resolves.toBe("translated_tts");
    expect(room.setSubscribed).toHaveBeenCalledWith("tts-agent", true);
  });

  it("subscribes to the exact server-admitted Host microphone after takeover", async () => {
    const room = {
      connect: vi.fn().mockResolvedValue(undefined),
      publishPcmTrack: vi.fn().mockResolvedValue(undefined),
      setSubscribed: vi.fn().mockResolvedValue(undefined),
    };
    const participant = new AirDeviceLiveKitParticipant({
      room,
      communicationSessionId: "session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "agent_monitored",
      token: "signed-token",
      wsUrl: "wss://livekit.example.cn",
    });
    const publisherIdentity = "session-1:host:user-1";

    await expect(participant.handleRemoteTrack({
      sid: "host-microphone",
      name: "microphone",
      publisherIdentity,
      admission: {
        uplinkSource: "takeover_microphone",
        trackSid: "host-microphone",
        trackName: "microphone",
        publisherIdentity,
        communicationSessionId: "session-1",
        targetParticipantIdentity: "session-1:guest:air:air-001",
        deviceId: "air-001",
        leaseId: "lease-1",
        callGeneration: 3,
      },
    })).resolves.toBe("takeover_microphone");
    expect(room.setSubscribed).toHaveBeenCalledWith("host-microphone", true);
  });

  it.each([
    {
      label: "cross-session publisher",
      publisherIdentity: "session-2:worker:translation",
      admission: {
        uplinkSource: "translated_tts",
        trackSid: "forged-track",
        trackName: "translation-tts-guest-24000.c2Vzc2lvbi0xOmd1ZXN0OmFpcjphaXItMDAx",
        publisherIdentity: "session-2:worker:translation",
        communicationSessionId: "session-1",
        targetParticipantIdentity: "session-1:guest:air:air-001",
        deviceId: "air-001",
        leaseId: "lease-1",
        callGeneration: 3,
      },
    },
    {
      label: "old lease",
      publisherIdentity: "session-1:worker:translation",
      admission: {
        uplinkSource: "translated_tts",
        trackSid: "forged-track",
        trackName: "translation-tts-guest-24000.c2Vzc2lvbi0xOmd1ZXN0OmFpcjphaXItMDAx",
        publisherIdentity: "session-1:worker:translation",
        communicationSessionId: "session-1",
        targetParticipantIdentity: "session-1:guest:air:air-001",
        deviceId: "air-001",
        leaseId: "lease-old",
        callGeneration: 3,
      },
    },
    {
      label: "old generation",
      publisherIdentity: "session-1:worker:translation",
      admission: {
        uplinkSource: "translated_tts",
        trackSid: "forged-track",
        trackName: "translation-tts-guest-24000.c2Vzc2lvbi0xOmd1ZXN0OmFpcjphaXItMDAx",
        publisherIdentity: "session-1:worker:translation",
        communicationSessionId: "session-1",
        targetParticipantIdentity: "session-1:guest:air:air-001",
        deviceId: "air-001",
        leaseId: "lease-1",
        callGeneration: 2,
      },
    },
    {
      label: "cross-device admission",
      publisherIdentity: "session-1:worker:translation",
      admission: {
        uplinkSource: "translated_tts",
        trackSid: "forged-track",
        trackName: "translation-tts-guest-24000.c2Vzc2lvbi0xOmd1ZXN0OmFpcjphaXItMDAx",
        publisherIdentity: "session-1:worker:translation",
        communicationSessionId: "session-1",
        targetParticipantIdentity: "session-1:guest:air:air-001",
        deviceId: "air-002",
        leaseId: "lease-1",
        callGeneration: 3,
      },
    },
    {
      label: "missing server admission",
      publisherIdentity: "session-1:worker:translation",
      admission: undefined,
    },
    {
      label: "admission replayed for another track",
      publisherIdentity: "session-1:worker:translation",
      admission: {
        uplinkSource: "translated_tts",
        trackSid: "previous-track",
        trackName: "translation-tts-guest-24000.c2Vzc2lvbi0xOmd1ZXN0OmFpcjphaXItMDAx",
        publisherIdentity: "session-1:worker:translation",
        communicationSessionId: "session-1",
        targetParticipantIdentity: "session-1:guest:air:air-001",
        deviceId: "air-001",
        leaseId: "lease-1",
        callGeneration: 3,
      },
    },
  ])("rejects $label even when the target track name is forged", async (input) => {
    const setSubscribed = vi.fn().mockResolvedValue(undefined);
    const participant = new AirDeviceLiveKitParticipant({
      room: {
        connect: vi.fn().mockResolvedValue(undefined),
        publishPcmTrack: vi.fn().mockResolvedValue(undefined),
        setSubscribed,
      },
      communicationSessionId: "session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "translation_isolated",
      token: "signed-token",
      wsUrl: "wss://livekit.example.cn",
    });
    const target = Buffer.from("session-1:guest:air:air-001").toString("base64url");

    await participant.handleRemoteTrack({
      sid: "forged-track",
      name: `translation-tts-guest-24000.${target}`,
      publisherIdentity: input.publisherIdentity,
      admission: input.admission,
    });

    expect(setSubscribed).toHaveBeenCalledWith("forged-track", false);
  });

  it("keeps autoSubscribe false and raw audio denied across reconnects", async () => {
    const room = {
      connect: vi.fn().mockResolvedValue(undefined),
      publishPcmTrack: vi.fn().mockResolvedValue(undefined),
      setSubscribed: vi.fn().mockResolvedValue(undefined),
    };
    const participant = new AirDeviceLiveKitParticipant({
      room,
      communicationSessionId: "session-1",
      deviceId: "air-001",
      leaseId: "lease-1",
      callGeneration: 3,
      mediaPolicy: "translation_isolated",
      token: "signed-token",
      wsUrl: "wss://livekit.example.cn",
    });

    await participant.connect();
    await participant.connect();
    await participant.handleRemoteTrack({
      sid: "raw-after-reconnect",
      name: "air780-downlink-other-device",
      publisherIdentity: "session-1:guest:air:air-002",
    });

    expect(room.connect).toHaveBeenCalledTimes(2);
    expect(room.connect).toHaveBeenNthCalledWith(
      2,
      "wss://livekit.example.cn",
      "signed-token",
      {
        autoSubscribe: false,
        communicationSessionId: "session-1",
        mediaPolicy: "translation_isolated",
      },
    );
    expect(room.setSubscribed).toHaveBeenCalledWith(
      "raw-after-reconnect",
      false,
    );
  });
});
