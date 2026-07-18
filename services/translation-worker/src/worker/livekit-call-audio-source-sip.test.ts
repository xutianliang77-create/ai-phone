import { describe, expect, it } from "vitest";
import type { CallSipStatusReporter } from "./call-sip-status-client.js";
import { LiveKitCallAudioSource } from "./livekit-call-audio-source.js";
import type { CallAudioFrame } from "./types.js";

describe("LiveKitCallAudioSource SIP answer gate", () => {
  it("holds early media until active is persisted, then forwards audio", async () => {
    const rtc = createFakeRtcNode();
    const worker = new RecordingWorker();
    const updates: unknown[] = [];
    const source = sourceFor(rtc, worker, {
      async reportStatus(_callId, update) {
        updates.push(update);
      },
    });
    const participant = sipParticipant("dialing");

    await source.start();
    rtc.room.emit(
      "trackSubscribed",
      new rtc.RemoteAudioTrack(),
      {},
      participant,
    );
    await nextTurn();
    expect(worker.frames).toEqual([]);

    participant.attributes["sip.callStatus"] = "active";
    rtc.room.emit(
      "participantAttributesChanged",
      { "sip.callStatus": "active" },
      participant,
    );
    await eventually(() => worker.frames.length === 1);
    await source.stop();

    expect(updates).toEqual([{
      operationId: "op_1",
      participantIdentity: "call_1:guest:sip:op_1",
      participantSid: "PA_1",
      sipCallId: "sip-call-1",
      callStatus: "active",
    }]);
    expect(worker.frames[0]).toMatchObject({
      sessionId: "call_1",
      speakerRole: "guest",
      sequence: 1,
    });
  });

  it("keeps the gate closed when status persistence fails", async () => {
    const rtc = createFakeRtcNode();
    const worker = new RecordingWorker();
    const errors: unknown[] = [];
    const source = sourceFor(rtc, worker, {
      async reportStatus() {
        throw new Error("status unavailable");
      },
    }, errors);

    await source.start();
    rtc.room.emit(
      "trackSubscribed",
      new rtc.RemoteAudioTrack(),
      {},
      sipParticipant("active"),
    );
    await eventually(() => errors.length === 1);
    await source.stop();

    expect(worker.frames).toEqual([]);
    expect(errors[0]).toMatchObject({ message: "status unavailable" });
  });

  it("reports hangup attribute changes without opening the audio gate", async () => {
    const rtc = createFakeRtcNode();
    const worker = new RecordingWorker();
    const updates: Array<{ callStatus: string }> = [];
    const source = sourceFor(rtc, worker, {
      async reportStatus(_callId, update) {
        updates.push(update);
      },
    });
    const participant = sipParticipant("dialing");

    await source.start();
    participant.attributes["sip.callStatus"] = "hangup";
    rtc.room.emit(
      "participantAttributesChanged",
      { "sip.callStatus": "hangup" },
      participant,
    );
    await eventually(() => updates.length === 1);
    await source.stop();

    expect(updates[0]?.callStatus).toBe("hangup");
    expect(worker.frames).toEqual([]);
  });
});

function sourceFor(
  rtc: ReturnType<typeof createFakeRtcNode>,
  worker: RecordingWorker,
  sipStatusClient: CallSipStatusReporter,
  errors: unknown[] = [],
) {
  return new LiveKitCallAudioSource({
    callId: "call_1",
    worker: worker as never,
    audioSampleRate: 24000,
    audioFrameSizeMs: 100,
    sipStatusClient,
    onError: (error) => errors.push(error),
    tokenClient: {
      async createWorkerToken() {
        return {
          callId: "call_1",
          sessionId: "call_1",
          provider: "livekit" as const,
          roomName: "call_call_1",
          wsUrl: "wss://livekit.example.cn",
          participantRole: "worker" as const,
          token: "worker-token",
          expiresAt: "2026-07-17T00:00:00.000Z",
        };
      },
    },
    loadRtcNode: async () => rtc.module,
  });
}

function sipParticipant(callStatus: "dialing" | "active" | "hangup") {
  return {
    sid: "PA_1",
    identity: "call_1:guest:sip:op_1",
    metadata: JSON.stringify({ participantRole: "guest" }),
    attributes: {
      "translation.operationId": "op_1",
      "translation.sessionId": "call_1",
      "translation.role": "guest",
      "sip.callID": "sip-call-1",
      "sip.callStatus": callStatus,
    },
  };
}

class RecordingWorker {
  readonly frames: CallAudioFrame[] = [];
  async startCall() {}
  async processAudioFrame(frame: CallAudioFrame) {
    this.frames.push(frame);
  }
  async endCall() {}
  addTtsAudioSink() {}
  setTtsVoice() {}
}

function createFakeRtcNode() {
  class RemoteAudioTrack {}
  class FakeAudioStream extends ReadableStream<{
    data: Int16Array;
    sampleRate: number;
  }> {
    constructor() {
      super({
        start(controller) {
          controller.enqueue({ data: new Int16Array([1, -1]), sampleRate: 24000 });
          controller.close();
        },
      });
    }
  }
  const room = new FakeRoom();
  return {
    room,
    RemoteAudioTrack,
    module: {
      Room: class {
        constructor() {
          return room;
        }
      },
      RoomEvent: {
        TrackSubscribed: "trackSubscribed",
        Disconnected: "disconnected",
        ParticipantAttributesChanged: "participantAttributesChanged",
      },
      AudioStream: FakeAudioStream,
      RemoteAudioTrack,
      async dispose() {},
    },
  };
}

class FakeRoom {
  private readonly listeners = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();

  on(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  async connect() {}
  async disconnect() {
    this.emit("disconnected");
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

async function nextTurn() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) return;
    await nextTurn();
  }
  expect(predicate()).toBe(true);
}
