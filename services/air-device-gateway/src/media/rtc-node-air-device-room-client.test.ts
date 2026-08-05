import { describe, expect, it, vi } from "vitest";
import { RtcNodeAirDeviceRoomClient } from
  "./rtc-node-air-device-room-client.js";

describe("rtc-node Air device room client", () => {
  it("connects with autoSubscribe=false and publishes exact PCM frames", async () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module);

    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
    });
    const samples = Int16Array.from({ length: 320 }, (_, index) => index - 160);
    await client.publishPcmTrack("air780-downlink-air-1", samples, 16_000);

    expect(fixture.room.connect).toHaveBeenCalledWith(
      "wss://livekit.example.cn",
      "bound-token",
      { autoSubscribe: false, dynacast: false },
    );
    expect(fixture.publishTrack).toHaveBeenCalledOnce();
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
    const client = new RtcNodeAirDeviceRoomClient(fixture.module);
    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
    });

    await client.setSubscribed("track-1", true);
    await expect(client.setSubscribed("forged-track", true))
      .rejects.toThrow("track is unavailable");

    expect(setSubscribed).toHaveBeenCalledOnce();
    expect(setSubscribed).toHaveBeenCalledWith(true);
  });

  it("reads subscribed remote audio as copied 16k/20ms mono frames", async () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module);
    const observed: unknown[] = [];
    client.onSubscribedAudioFrame((frame) => observed.push(frame));
    await client.connect("wss://livekit.example.cn", "bound-token", {
      autoSubscribe: false,
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

  it("fails closed when callers try to enable auto-subscribe", async () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module);

    await expect(client.connect("wss://livekit.example.cn", "token", {
      autoSubscribe: true,
    } as { autoSubscribe: false })).rejects.toThrow("autoSubscribe=false");
    expect(fixture.room.connect).not.toHaveBeenCalled();
  });

  it("forwards reconnect and disconnect lifecycle events", () => {
    const fixture = rtcFixture();
    const client = new RtcNodeAirDeviceRoomClient(fixture.module);
    const observed: string[] = [];
    client.onConnectionState((state) => observed.push(state));

    fixture.emit("reconnecting");
    fixture.emit("reconnected");
    fixture.emit("disconnected");

    expect(observed).toEqual(["reconnecting", "joined", "disconnected"]);
  });

  it("fails closed on reconnect and re-emits tracks for fresh admission", () => {
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
    const client = new RtcNodeAirDeviceRoomClient(fixture.module);
    const observed: unknown[] = [];
    client.onRemoteTrackPublished((track) => observed.push(track));

    fixture.emit("reconnecting");
    fixture.emit("reconnected");

    expect(setSubscribed).toHaveBeenCalledWith(false);
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
});

function rtcFixture() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const audioControllers: ReadableStreamDefaultController<{
    data: Int16Array;
    sampleRate: number;
    channels: number;
    samplesPerChannel: number;
  }>[] = [];
  let audioStreamOptions: unknown;
  const captureFrame = vi.fn(async () => undefined);
  const publishTrack = vi.fn(async () => ({ sid: "local-track-1" }));
  const room = {
    isConnected: false,
    connect: vi.fn(async () => { room.isConnected = true; }),
    disconnect: vi.fn(async () => { room.isConnected = false; }),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      const registered = listeners.get(event) ??
        new Set<(...args: any[]) => void>();
      registered.add(listener);
      listeners.set(event, registered);
      return room;
    }),
    localParticipant: { publishTrack },
    remoteParticipants: new Map<string, {
      identity?: string;
      trackPublications: Map<string, {
        sid: string;
        name?: string;
        setSubscribed(value: boolean): void;
      }>;
    }>(),
  };
  class Room { constructor() { return room; } }
  class AudioSource {
    captureFrame = captureFrame;
    clearQueue = vi.fn();
    close = vi.fn(async () => undefined);
    constructor(readonly sampleRate: number, readonly channels: number) {}
  }
  class AudioFrame {
    constructor(
      readonly data: Int16Array,
      readonly sampleRate: number,
      readonly channels: number,
      readonly samplesPerChannel: number,
    ) {}
  }
  class AudioStream extends ReadableStream<{
    data: Int16Array;
    sampleRate: number;
    channels: number;
    samplesPerChannel: number;
  }> {
    constructor(_track: unknown, options: unknown) {
      let saved!: ReadableStreamDefaultController<{
        data: Int16Array;
        sampleRate: number;
        channels: number;
        samplesPerChannel: number;
      }>;
      super({ start: (controller) => { saved = controller; } });
      audioStreamOptions = options;
      audioControllers.push(saved);
    }
  }
  class TrackPublishOptions { source = 0; }
  const track = { close: vi.fn(async () => undefined) };
  return {
    captureFrame,
    publishTrack,
    room,
    module: {
      Room,
      AudioSource,
      AudioFrame,
      AudioStream,
      LocalAudioTrack: {
        createAudioTrack: vi.fn(() => track),
      },
      TrackPublishOptions,
      TrackSource: { SOURCE_MICROPHONE: 2 },
      RoomEvent: {
        Reconnecting: 'reconnecting',
        Reconnected: 'reconnected',
        Disconnected: 'disconnected',
        TrackPublished: 'trackPublished',
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
      },
    },
    get audioStreamOptions() { return audioStreamOptions; },
    pushAudio: (frame: {
      data: Int16Array;
      sampleRate: number;
      channels: number;
      samplesPerChannel: number;
    }) => audioControllers.at(-1)?.enqueue({
      ...frame,
      data: Int16Array.from(frame.data),
    }),
    emit: (event: string, ...args: any[]) =>
      listeners.get(event)?.forEach((listener) => listener(...args)),
  };
}
