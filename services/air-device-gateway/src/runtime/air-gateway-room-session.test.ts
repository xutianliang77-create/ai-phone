import { describe, expect, it, vi } from "vitest";
import type { AirDeviceRoomClient } from
  "../media/livekit-device-participant.js";
import { AirGatewayRoomSession } from "./air-gateway-room-session.js";

describe("Air Gateway LiveKit room session", () => {
  it("connects once with autoSubscribe disabled for an exact replay", async () => {
    const fixture = setup();

    await expect(fixture.session.prepare(dial())).resolves.toBe(true);
    await expect(fixture.session.prepare(dial())).resolves.toBe(false);

    expect(fixture.createRoom).toHaveBeenCalledOnce();
    expect(fixture.room.connect).toHaveBeenCalledOnce();
    expect(fixture.room.connect).toHaveBeenCalledWith(
      "wss://livekit.example.cn/",
      "room-token",
      {
        autoSubscribe: false,
        communicationSessionId: "comm-1",
        mediaPolicy: "translation_isolated",
      },
    );
    expect(fixture.session.snapshot()).toMatchObject({
      state: "connected",
      communicationSessionId: "comm-1",
      deviceId: "air-780-1",
      callGeneration: 3,
    });
  });

  it("rejects cross-session replacement until the active generation ends", async () => {
    const fixture = setup();
    await fixture.session.prepare(dial());

    await expect(fixture.session.prepare(dial({
      communicationSessionId: "comm-2",
      providerCallId: "air-call-2",
      commandId: "command-2",
      providerOperationId: "operation-2",
      idempotencyKey: "dial:comm-2:1",
      participantIdentity: "comm-2:guest:air:air-780-1",
      roomName: "call_comm-2",
    }))).rejects.toThrow("room session is already active");
    expect(fixture.createRoom).toHaveBeenCalledOnce();
  });

  it("disconnects the exact generation and rejects a stale clear", async () => {
    const fixture = setup();
    await fixture.session.prepare(dial());

    expect(await fixture.session.clear({ ...binding, callGeneration: 2 }))
      .toBe(false);
    expect(fixture.room.disconnect).not.toHaveBeenCalled();
    expect(await fixture.session.clear(binding)).toBe(true);
    expect(fixture.room.disconnect).toHaveBeenCalledOnce();
    expect(fixture.session.snapshot().state).toBe("absent");
  });

  it("reports joining, joined, reconnecting and disconnected separately", async () => {
    const fixture = setup();
    await fixture.session.prepare(dial());

    fixture.emitConnectionState("reconnecting");
    fixture.emitConnectionState("joined");
    await fixture.session.clear(binding);

    expect(fixture.onParticipantState.mock.calls.map(([event]) =>
      [event.liveKitParticipantState, event.eventSequence])).toEqual([
      ["joining", 1],
      ["joined", 2],
      ["reconnecting", 3],
      ["joined", 4],
      ["disconnected", 5],
    ]);
  });

  it("clears local RTC resources after an unexpected room disconnect", async () => {
    const fixture = setup();
    await fixture.session.prepare(dial());

    fixture.emitConnectionState("disconnected");
    await vi.waitFor(() => expect(fixture.room.disconnect).toHaveBeenCalledOnce());

    expect(fixture.session.snapshot().state).toBe("absent");
    expect(fixture.onParticipantState).toHaveBeenLastCalledWith(
      expect.objectContaining({ liveKitParticipantState: "disconnected" }),
    );
  });

  it("subscribes only after an exact API track admission", async () => {
    const fixture = setup();
    await fixture.session.prepare(dial());
    const target = "comm-1:guest:air:air-780-1";
    const name = `translation-tts-guest-1.${Buffer.from(target)
      .toString("base64url")}`;

    fixture.emitRemoteTrack({
      sid: "TR_tts_1",
      name,
      publisherIdentity: "comm-1:worker:voice-agent-1",
    });
    fixture.emitRemoteTrack({
      sid: "TR_forged",
      name,
      publisherIdentity: "comm-2:worker:voice-agent-1",
    });
    await vi.waitFor(() => expect(fixture.room.setSubscribed)
      .toHaveBeenCalledTimes(2));

    expect(fixture.admitTrack).toHaveBeenCalledWith(expect.objectContaining({
      roomName: "call_comm-1",
      fencingToken: 7,
      trackSid: "TR_tts_1",
      targetParticipantIdentity: target,
    }));
    expect(fixture.room.setSubscribed.mock.calls).toEqual([
      ["TR_tts_1", true],
      ["TR_forged", false],
    ]);
    expect(fixture.session.snapshot()).toMatchObject({
      trackAdmissionAttempts: 2,
      trackAdmissions: 1,
      trackRejections: 1,
    });
  });

  it("forwards PCM only from the currently admitted exact TTS track", async () => {
    const fixture = setup();
    await fixture.session.prepare(dial());
    const target = "comm-1:guest:air:air-780-1";
    const name = `translation-tts-guest-1.${Buffer.from(target)
      .toString("base64url")}`;
    const samples = Int16Array.from({ length: 320 }, (_, index) => index);

    fixture.emitAudioFrame({ trackSid: "TR_tts_1", samples, sampleRate: 16_000 });
    fixture.emitRemoteTrack({
      sid: "TR_tts_1",
      name,
      publisherIdentity: "comm-1:worker:voice-agent-1",
    });
    await vi.waitFor(() => expect(fixture.room.setSubscribed)
      .toHaveBeenCalledWith("TR_tts_1", true));
    fixture.emitAudioFrame({ trackSid: "TR_raw_host", samples,
      sampleRate: 16_000 });
    fixture.emitAudioFrame({ trackSid: "TR_tts_1", samples,
      sampleRate: 16_000 });

    expect(fixture.onTtsFrame).toHaveBeenCalledOnce();
    expect(fixture.onTtsFrame).toHaveBeenCalledWith({
      ...binding,
      uplinkSource: "translated_tts",
      trackSid: "TR_tts_1",
      samples,
      sampleRate: 16_000,
    });
    expect(fixture.session.snapshot()).toMatchObject({
      ttsFramesAccepted: 1,
      ttsFramesRejected: 2,
    });

    fixture.emitConnectionState("reconnecting");
    fixture.emitAudioFrame({ trackSid: "TR_tts_1", samples,
      sampleRate: 16_000 });
    expect(fixture.onTtsFrame).toHaveBeenCalledOnce();
    expect(fixture.session.snapshot()).toMatchObject({ ttsFramesRejected: 3 });
  });

  it("switches atomically from Agent TTS to the accepted Host microphone", async () => {
    const fixture = setup();
    await fixture.session.prepare(dial({
      roomAccess: {
        ...dial().roomAccess,
        mediaPolicy: "agent_monitored",
      },
    }));
    const target = "comm-1:guest:air:air-780-1";
    const ttsName = `translation-tts-guest-1.${Buffer.from(target)
      .toString("base64url")}`;
    const samples = new Int16Array(320);

    fixture.emitRemoteTrack({
      sid: "TR_tts_1",
      name: ttsName,
      publisherIdentity: "comm-1:worker:voice-agent-1",
    });
    await vi.waitFor(() => expect(fixture.room.setSubscribed)
      .toHaveBeenCalledWith("TR_tts_1", true));
    fixture.emitRemoteTrack({
      sid: "TR_host_1",
      name: "microphone",
      publisherIdentity: "comm-1:host:user-1",
    });
    await vi.waitFor(() => expect(fixture.room.setSubscribed)
      .toHaveBeenCalledWith("TR_host_1", true));

    fixture.emitAudioFrame({ trackSid: "TR_tts_1", samples, sampleRate: 16_000 });
    fixture.emitAudioFrame({ trackSid: "TR_host_1", samples, sampleRate: 16_000 });
    expect(fixture.onTtsFrame).toHaveBeenLastCalledWith(expect.objectContaining({
      trackSid: "TR_host_1",
      uplinkSource: "takeover_microphone",
    }));
    expect(fixture.onUplinkBoundary).toHaveBeenCalledWith(binding);
    expect(fixture.room.setSubscribed).toHaveBeenCalledWith("TR_tts_1", false);
  });
});

function setup() {
  let connectionListener: ((state: "reconnecting" | "joined" |
    "disconnected") => void) | undefined;
  let remoteTrackListener: ((track: {
    sid: string;
    name: string;
    publisherIdentity: string;
  }) => void) | undefined;
  let unavailableTrackListener: ((trackSid: string) => void) | undefined;
  let audioFrameListener: ((frame: {
    trackSid: string;
    samples: Int16Array;
    sampleRate: 16_000;
  }) => void) | undefined;
  const room: AirDeviceRoomClient = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    publishPcmTrack: vi.fn(async () => undefined),
    setSubscribed: vi.fn(async () => undefined),
    onConnectionState: vi.fn((listener) => {
      connectionListener = listener;
      return () => { connectionListener = undefined; };
    }),
    onRemoteTrackPublished: vi.fn((listener) => {
      remoteTrackListener = listener;
      return () => { remoteTrackListener = undefined; };
    }),
    onRemoteTrackUnpublished: vi.fn((listener) => {
      unavailableTrackListener = listener;
      return () => { unavailableTrackListener = undefined; };
    }),
    onSubscribedAudioFrame: vi.fn((listener) => {
      audioFrameListener = listener;
      return () => { audioFrameListener = undefined; };
    }),
  };
  const createRoom = vi.fn(() => room);
  const onParticipantState = vi.fn();
  const onTtsFrame = vi.fn();
  const onUplinkBoundary = vi.fn();
  const admitTrack = vi.fn(async (request: ReturnType<typeof admissionRequest>) => {
    const { roomName: _room, fencingToken: _fence, ...admission } = request;
    const uplinkSource = request.trackName === "microphone"
      ? "takeover_microphone" as const
      : "translated_tts" as const;
    return { uplinkSource, ...admission };
  });
  return {
    room,
    createRoom,
    onParticipantState,
    onTtsFrame,
    onUplinkBoundary,
    admitTrack,
    emitConnectionState: (state: "reconnecting" | "joined" |
      "disconnected") => connectionListener?.(state),
    emitRemoteTrack: (track: {
      sid: string;
      name: string;
      publisherIdentity: string;
    }) => remoteTrackListener?.(track),
    emitRemoteTrackUnavailable: (trackSid: string) =>
      unavailableTrackListener?.(trackSid),
    emitAudioFrame: (frame: {
      trackSid: string;
      samples: Int16Array;
      sampleRate: 16_000;
    }) => audioFrameListener?.(frame),
    session: new AirGatewayRoomSession({
      createRoom,
      onParticipantState,
      admitTrack,
      onTtsFrame,
      onUplinkBoundary,
    }),
  };
}

function admissionRequest() {
  return {
    communicationSessionId: "comm-1",
    roomName: "call_comm-1",
    deviceId: "air-780-1",
    leaseId: "lease-1",
    fencingToken: 7,
    callGeneration: 3,
    targetParticipantIdentity: "comm-1:guest:air:air-780-1",
    trackSid: "TR_tts_1",
    trackName: "translation-tts-guest-1.target",
    publisherIdentity: "comm-1:worker:voice-agent-1",
  };
}

function dial(overrides: Record<string, unknown> = {}) {
  return {
    type: "dial" as const,
    providerOperationId: "operation-1",
    commandId: "command-1",
    idempotencyKey: "dial:comm-1:1",
    ...binding,
    phoneNumberReference: "+8613800138000",
    participantIdentity: "comm-1:guest:air:air-780-1",
    roomName: "call_comm-1",
    roomAccess: {
      wsUrl: "wss://livekit.example.cn/",
      token: "room-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      mediaPolicy: "translation_isolated" as const,
    },
    ...overrides,
  };
}

const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};
