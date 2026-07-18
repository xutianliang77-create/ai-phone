import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  createCallRoomEventCollector,
  createTtsAudioObserver,
  publishWavAudioTrack,
  waitForWorkerParticipant,
} from "./translation_room_load_media.mjs";

describe("translation room load media", () => {
  it("matches one ASR, MT, and TTS generation and ignores participant data", async () => {
    const room = new FakeRoom();
    const collector = createCallRoomEventCollector(room, rtc, {
      nowMs: () => 100,
      sleep: immediateSleep,
    });
    room.emit("data", packet(event("transcript.final")), { identity: "peer" }, 0,
      "translation.captions");
    for (const type of ["transcript.final", "translation.final", "tts.ready"]) {
      room.emit("data", packet(event(type)), undefined, 0, "translation.captions");
    }

    const cycle = await collector.waitForCycle({
      afterIndex: 0,
      speakerRole: "host",
      timeoutMs: 100,
    });
    expect(cycle.transcript.event.speechId).toBe("speech-1");
    expect(cycle.translation.event.turnId).toBe("turn-1");
    expect(cycle.tts.event.provider).toBe("real-tts");
    expect(collector.events).toHaveLength(3);

    room.emit("data", packet(event("playback.ended")), undefined, 0,
      "translation.captions");
    await expect(collector.waitForEvent({
      afterIndex: 3,
      timeoutMs: 100,
      predicate: (item) => item.event.type === "playback.ended",
    })).resolves.toMatchObject({ event: { type: "playback.ended" } });
    collector.close();
  });

  it("publishes PCM frames, endpoint silence, and observes target TTS audio", async () => {
    const room = new FakeRoom();
    const published = await publishWavAudioTrack(room, rtc, {
      path: "fixture.wav",
      trackName: "load-host-session",
      readWav: () => ({ sampleRate: 1000, pcm: pcm([1, 2, 3, 4]) }),
      sleep: immediateSleep,
      nowMs: () => 10,
    });
    await published.play({ frameMs: 2, silenceMs: 2 });
    expect(room.localParticipant.source.frames).toHaveLength(3);
    expect([...room.localParticipant.source.frames.at(-1).data]).toEqual([0, 0]);

    const observer = createTtsAudioObserver(room, rtc, "guest", {
      sleep: immediateSleep,
      nowMs: () => 20,
    });
    room.emit("track", { name: "translation-tts-guest-24000.bGVn" }, {
      name: "translation-tts-guest-24000.bGVn",
    });
    await observer.waitForFrameAfter(0, 100);
    expect(observer.frameCount).toBe(1);
    await observer.close();
    await published.close();
  });

  it("requires a worker participant before sending load audio", async () => {
    const room = new FakeRoom();
    room.remoteParticipants.set("worker", {
      identity: "call-1:worker:translation",
    });
    await expect(waitForWorkerParticipant(room, 100, {
      sleep: immediateSleep,
    })).resolves.toBeUndefined();
  });
});

class FakeRoom extends EventEmitter {
  remoteParticipants = new Map();
  localParticipant = {
    source: null,
    publishTrack: async (track) => {
      this.localParticipant.source = track.source;
      return { sid: "track-1" };
    },
  };
}

class FakeAudioSource {
  frames = [];
  async captureFrame(frame) {
    this.frames.push(frame);
  }
  clearQueue() {}
}

class FakeAudioStream {
  getReader() {
    let read = false;
    return {
      async read() {
        if (read) return { done: true };
        read = true;
        return { done: false, value: { data: new Int16Array([1]) } };
      },
      async cancel() {},
      releaseLock() {},
    };
  }
}

const rtc = {
  RoomEvent: { DataReceived: "data", TrackSubscribed: "track" },
  AudioSource: FakeAudioSource,
  AudioStream: FakeAudioStream,
  AudioFrame: class {
    constructor(data) {
      this.data = data;
    }
  },
  LocalAudioTrack: {
    createAudioTrack: (name, source) => ({ name, source, async close() {} }),
  },
  TrackPublishOptions: class {},
  TrackSource: { SOURCE_MICROPHONE: "microphone" },
};

function event(type) {
  return {
    type,
    segmentId: "segment-1",
    speechId: "speech-1",
    turnId: "turn-1",
    revision: 1,
    pipelineGeneration: 1,
    speakerRole: "host",
    provider: "real-tts",
    model: "tts-model",
  };
}

function packet(value) {
  return Buffer.from(JSON.stringify(value));
}

function pcm(values) {
  const result = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => result.writeInt16LE(value, index * 2));
  return result;
}

function immediateSleep() {
  return Promise.resolve();
}
