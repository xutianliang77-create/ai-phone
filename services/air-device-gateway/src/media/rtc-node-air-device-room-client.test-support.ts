import { vi } from "vitest";

export function rtcNodeRoomFixture() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const audioControllers: ReadableStreamDefaultController<AudioFrameLike>[] = [];
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
    localParticipant: { publishTrack, ffi_handle: { handle: 7n } },
    remoteParticipants: new Map<string, {
      identity?: string;
      metadata?: string;
      attributes?: Record<string, string>;
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
  class AudioStream extends ReadableStream<AudioFrameLike> {
    constructor(_track: unknown, options: unknown) {
      let saved!: ReadableStreamDefaultController<AudioFrameLike>;
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
      LocalAudioTrack: { createAudioTrack: vi.fn(() => track) },
      TrackPublishOptions,
      TrackSource: { SOURCE_MICROPHONE: 2 },
      RoomEvent: {
        Reconnecting: "reconnecting",
        Reconnected: "reconnected",
        Disconnected: "disconnected",
        TrackPublished: "trackPublished",
        TrackSubscribed: "trackSubscribed",
        TrackUnsubscribed: "trackUnsubscribed",
        TrackUnpublished: "trackUnpublished",
        ParticipantConnected: "participantConnected",
        ParticipantDisconnected: "participantDisconnected",
        ParticipantAttributesChanged: "participantAttributesChanged",
        ParticipantMetadataChanged: "participantMetadataChanged",
      },
    },
    get audioStreamOptions() { return audioStreamOptions; },
    pushAudio: (frame: AudioFrameLike) => audioControllers.at(-1)?.enqueue({
      ...frame,
      data: Int16Array.from(frame.data),
    }),
    emit: (event: string, ...args: any[]) =>
      listeners.get(event)?.forEach((listener) => listener(...args)),
  };
}

interface AudioFrameLike {
  data: Int16Array;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
}
