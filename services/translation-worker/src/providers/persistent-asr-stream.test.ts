import { describe, expect, it } from "vitest";
import {
  encodeAudioFrame,
  PersistentAsrStream,
  type AsrWebSocketLike,
} from "./persistent-asr-stream.js";

describe("PersistentAsrStream", () => {
  it("reuses one authenticated socket and sends raw PCM binary frames", async () => {
    const socket = new FakeSocket();
    const stream = createStream(() => socket);

    const first = await stream.transcribe(frame(1, "AQI="));
    const second = await stream.transcribe(frame(2, "AwQ="));

    expect(socket.openMessages).toHaveLength(1);
    expect(socket.openMessages[0]).toMatchObject({
      type: "session.open",
      sessionId: "call_1:guest",
      apiKey: "secret",
    });
    expect(socket.binaryFrames.map((item) => [...item.pcm])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(first.transcript?.segmentId).toBe("seg_1");
    expect(second.transcript?.segmentId).toBe("seg_2");
  });

  it("reconnects and resends the same sequence after a dropped response", async () => {
    let created = 0;
    const stream = createStream(() => {
      created += 1;
      return new FakeSocket({ dropFirstFrame: created === 1 });
    });

    const response = await stream.transcribe(frame(9, "AQI="));

    expect(response.sequence).toBe(9);
    expect(created).toBe(2);
  });

  it("flushes and closes the server-side session", async () => {
    const socket = new FakeSocket();
    const stream = createStream(() => socket);
    await stream.transcribe(frame(1, "AQI="));

    expect((await stream.flush()).type).toBe("session.flushed");
    await stream.close();

    expect(socket.commands.map((command) => command.type)).toEqual([
      "session.flush",
      "session.close",
    ]);
    expect(socket.readyState).toBe(3);
  });
});

describe("encodeAudioFrame", () => {
  it("prefixes the JSON header length before PCM bytes", () => {
    const payload = Buffer.from(encodeAudioFrame({ type: "audio.frame", sequence: 3 },
      Uint8Array.from([7, 8])));
    const headerSize = payload.readUInt32BE(0);
    expect(JSON.parse(payload.subarray(4, 4 + headerSize).toString("utf8")))
      .toEqual({ type: "audio.frame", sequence: 3 });
    expect([...payload.subarray(4 + headerSize)]).toEqual([7, 8]);
  });
});

function createStream(factory: () => AsrWebSocketLike) {
  return new PersistentAsrStream("call_1", "guest", {
    endpoint: "ws://models.local:8001/asr/stream",
    apiKey: "secret",
    timeoutMs: 100,
    endpointMode: "call_link",
    hotwords: ["LiveKit"],
    corrections: [],
    webSocketFactory: factory,
  });
}

function frame(sequence: number, data: string) {
  return {
    type: "audio.frame" as const,
    sessionId: "call_1",
    speakerRole: "guest" as const,
    sequence,
    timestampMs: sequence * 100,
    format: "pcm16" as const,
    sampleRate: 24000 as const,
    data,
  };
}

class FakeSocket implements AsrWebSocketLike {
  readyState = 0;
  readonly openMessages: Array<Record<string, unknown>> = [];
  readonly commands: Array<Record<string, unknown>> = [];
  readonly binaryFrames: Array<{ header: Record<string, unknown>; pcm: Buffer }> = [];
  private readonly listeners = new Map<string, Set<(event: Event | MessageEvent) => void>>();
  private dropped = false;

  constructor(private readonly options: { dropFirstFrame?: boolean } = {}) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", new Event("open"));
    });
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    if (typeof data === "string") {
      const message = JSON.parse(data) as Record<string, unknown>;
      if (message.type === "session.open") {
        this.openMessages.push(message);
        this.reply({ type: "session.ready" });
      } else {
        this.commands.push(message);
        this.reply({
          type: message.type === "session.flush" ? "session.flushed" : "session.closed",
          requestId: message.requestId,
          transcript: null,
        });
      }
      return;
    }
    const payload = Buffer.from(data);
    const headerSize = payload.readUInt32BE(0);
    const header = JSON.parse(
      payload.subarray(4, 4 + headerSize).toString("utf8"),
    ) as Record<string, unknown>;
    this.binaryFrames.push({
      header,
      pcm: payload.subarray(4 + headerSize),
    });
    if (this.options.dropFirstFrame && !this.dropped) {
      this.dropped = true;
      this.readyState = 3;
      this.emit("close", new Event("close"));
      return;
    }
    this.reply({
      type: "asr.result",
      requestId: header.requestId,
      sequence: header.sequence,
      transcript: {
        segmentId: `seg_${header.sequence}`,
        text: "hello",
        language: "en",
      },
    });
  }

  close() {
    this.readyState = 3;
  }

  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: Event | MessageEvent) => void,
  ) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: Event | MessageEvent) => void,
  ) {
    this.listeners.get(type)?.delete(listener);
  }

  private reply(body: Record<string, unknown>) {
    queueMicrotask(() => this.emit("message", {
      data: JSON.stringify(body),
    } as MessageEvent));
  }

  private emit(type: string, event: Event | MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
