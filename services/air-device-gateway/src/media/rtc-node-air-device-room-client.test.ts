import { describe, expect, it, vi } from "vitest";
import { RtcNodeAirDeviceRoomClient } from
  "./rtc-node-air-device-room-client.js";
import { rtcNodeRoomFixture as rtcFixture } from
  "./rtc-node-air-device-room-client.test-support.js";

describe("rtc-node Air device room client", () => {
  it("connects with autoSubscribe=false and publishes exact PCM frames", async () => {
    const fixture = rtcFixture();
    const setPermissions = vi.fn();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module, setPermissions);

    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    });
    const samples = Int16Array.from({ length: 320 }, (_, index) => index - 160);
    await client.publishPcmTrack("air780-downlink-air-1", samples, 16_000);

    expect(fixture.room.connect).toHaveBeenCalledWith(
      "wss://livekit.example.cn",
      "bound-token",
      { autoSubscribe: false, dynacast: false },
    );
    expect(fixture.publishTrack).toHaveBeenCalledOnce();
    expect(setPermissions).toHaveBeenCalledWith(
      fixture.room.localParticipant,
      [],
    );
    expect(fixture.captureFrame).toHaveBeenCalledWith(expect.objectContaining({
      data: samples,
      sampleRate: 16_000,
      channels: 1,
      samplesPerChannel: 320,
    }));
  });

  it("changes only the requested remote publication subscription", async () => {
    const fixture = rtcFixture();
    const setSubscribed = vi.fn();
    fixture.room.remoteParticipants.set("worker-1", {
      trackPublications: new Map([["track-1", {
        sid: "track-1",
        setSubscribed,
      }]]),
    });
    const client = new RtcNodeAirDeviceRoomClient(fixture.module, vi.fn());
    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    });

    await client.setSubscribed("track-1", true);
    await expect(client.setSubscribed("forged-track", true))
      .rejects.toThrow("track is unavailable");

    expect(setSubscribed).toHaveBeenCalledOnce();
    expect(setSubscribed).toHaveBeenCalledWith(true);
  });

  it("reads subscribed remote audio as copied 16k/20ms mono frames", async () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module, vi.fn());
    const observed: unknown[] = [];
    client.onSubscribedAudioFrame((frame) => observed.push(frame));
    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    });

    const publication = { sid: "track-tts", name: "translation-tts" };
    fixture.emit("trackSubscribed", { kind: "audio" }, publication, {
      identity: "comm-1:worker:voice-agent-1",
    });
    const samples = Int16Array.from({ length: 320 }, (_, index) => index - 160);
    fixture.pushAudio({
      data: samples,
      sampleRate: 16_000,
      channels: 1,
      samplesPerChannel: 320,
    });
    samples.fill(0);
    await vi.waitFor(() => expect(observed).toHaveLength(1));

    expect(observed).toEqual([{
      trackSid: "track-tts",
      samples: Int16Array.from({ length: 320 }, (_, index) => index - 160),
      sampleRate: 16_000,
    }]);
    expect(fixture.audioStreamOptions).toEqual({
      sampleRate: 16_000,
      numChannels: 1,
      frameSizeMs: 20,
    });
  });

  it("reports subscription and publication boundaries to the media assembler", async () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module, vi.fn());
    const unavailable: string[] = [];
    client.onRemoteTrackUnpublished((trackSid) => unavailable.push(trackSid));
    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    });

    fixture.emit("trackUnsubscribed", {}, { sid: "TR_1" });
    fixture.emit("trackUnpublished", { sid: "TR_2" });

    expect(unavailable).toEqual(["TR_1", "TR_2"]);
  });

  it("fails closed when callers try to enable auto-subscribe", async () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module, vi.fn());

    await expect(client.connect("wss://livekit.example.cn", "token", {
      autoSubscribe: true,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    } as never)).rejects.toThrow("autoSubscribe=false");
    expect(fixture.room.connect).not.toHaveBeenCalled();
  });

  it("forwards reconnect and disconnect lifecycle events", async () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module, vi.fn());
    const observed: string[] = [];
    client.onConnectionState((state) => observed.push(state));

    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    });

    fixture.emit("reconnecting");
    fixture.emit("reconnected");
    await vi.waitFor(() => expect(observed).toEqual(["reconnecting", "joined"]));
    fixture.emit("disconnected");

    expect(observed).toEqual(["reconnecting", "joined", "disconnected"]);
  });

  it("fails closed on reconnect and re-emits tracks for fresh admission", async () => {
    const fixture = rtcFixture();
    const setSubscribed = vi.fn();
    fixture.room.remoteParticipants.set("worker-1", {
      identity: "comm-1:worker:voice-agent-1",
      trackPublications: new Map([["track-1", {
        sid: "track-1",
        name: "translation-tts-guest-1.target",
        setSubscribed,
      }]]),
    });
    const client = new RtcNodeAirDeviceRoomClient(fixture.module, vi.fn());
    const observed: unknown[] = [];
    client.onRemoteTrackPublished((track) => observed.push(track));

    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    });

    fixture.emit("reconnecting");
    fixture.emit("reconnected");

    expect(setSubscribed).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(observed).toHaveLength(2));
    expect(observed).toEqual([
      {
        sid: "track-1",
        name: "translation-tts-guest-1.target",
        publisherIdentity: "comm-1:worker:voice-agent-1",
      },
      {
        sid: "track-1",
        name: "translation-tts-guest-1.target",
        publisherIdentity: "comm-1:worker:voice-agent-1",
      },
    ]);
  });

  it("enforces purpose-aware raw downlink permissions", async () => {
    const fixture = rtcFixture();
    fixture.room.remoteParticipants.set("comm-1:worker:translation", {
      identity: "comm-1:worker:translation",
      attributes: {
        "ai.phone.call_id": "comm-1",
        "ai.phone.participant_role": "worker",
      },
      trackPublications: new Map(),
    });
    fixture.room.remoteParticipants.set("comm-1:host:12345678-1234-1234", {
      identity: "comm-1:host:12345678-1234-1234",
      attributes: {
        "ai.phone.call_id": "comm-1",
        "ai.phone.participant_role": "host",
      },
      trackPublications: new Map(),
    });
    const translationPermissions = vi.fn();
    const translation = new RtcNodeAirDeviceRoomClient(
      fixture.module,
      translationPermissions,
    );
    await translation.connect("wss://livekit.example.cn", "token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    });
    expect(translationPermissions).toHaveBeenLastCalledWith(
      fixture.room.localParticipant,
      ["comm-1:worker:translation"],
    );

    await translation.disconnect();
    const monitoredPermissions = vi.fn();
    const monitored = new RtcNodeAirDeviceRoomClient(
      fixture.module,
      monitoredPermissions,
    );
    await monitored.connect("wss://livekit.example.cn", "token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "agent_monitored",
    });
    expect(monitoredPermissions).toHaveBeenLastCalledWith(
      fixture.room.localParticipant,
      ["comm-1:host:12345678-1234-1234", "comm-1:worker:translation"],
    );
  });

  it("fails room preparation when publish permissions cannot be installed", async () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module, () => {
      throw new Error("permission unavailable");
    });
    await expect(client.connect("wss://livekit.example.cn", "token", {
      autoSubscribe: false,
      communicationSessionId: "comm-1",
      mediaPolicy: "translation_isolated",
    })).rejects.toThrow("permission unavailable");
    expect(fixture.room.disconnect).toHaveBeenCalledOnce();
  });
});
