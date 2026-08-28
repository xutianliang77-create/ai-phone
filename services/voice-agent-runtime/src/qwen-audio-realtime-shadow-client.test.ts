import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  QwenAudioRealtimeShadowClient,
  type QwenAudioShadowSocket,
} from "./qwen-audio-realtime-shadow-client.js";
import type { QwenAudioRealtimeShadowConfig } from "./config.js";

describe("QwenAudioRealtimeShadowClient", () => {
  it("configures text-only observer mode without tools", async () => {
    const socket = new FakeSocket();
    const client = createClient(socket);

    const connecting = client.connect();
    socket.open();
    await waitForSessionUpdate(socket);
    socket.serverEvent({
      type: "session.updated",
      session: { modalities: ["text"] },
    });
    await connecting;

    const update = JSON.parse(socket.sent[0]!) as {
      session: Record<string, unknown>;
    };
    expect(update.session.modalities).toEqual(["text"]);
    expect(update.session.input_audio_format).toBe("pcm");
    expect(update.session).not.toHaveProperty("tools");
    expect(update.session).not.toHaveProperty("voice");
  });

  it("accepts only a bounded 100 ms PCM16 chunk", async () => {
    const socket = new FakeSocket();
    const client = createClient(socket);
    const connecting = client.connect();
    socket.open();
    await waitForSessionUpdate(socket);
    socket.serverEvent({
      type: "session.updated",
      session: { modalities: ["text"] },
    });
    await connecting;

    expect(client.appendPcm100ms(Buffer.alloc(3_200, 7))).toBe(true);
    expect(client.appendPcm100ms(Buffer.alloc(640))).toBe(false);
    socket.bufferedAmount = 9_601;
    expect(client.appendPcm100ms(Buffer.alloc(3_200))).toBe(false);
    expect(client.telemetry()).toMatchObject({
      audioChunksSent: 1,
      audioChunksDropped: 2,
    });
  });

  it("terminates the observer if the server violates text-only mode", async () => {
    const socket = new FakeSocket();
    const client = createClient(socket);
    const connecting = client.connect();
    socket.open();
    await waitForSessionUpdate(socket);
    socket.serverEvent({
      type: "session.updated",
      session: { modalities: ["text"] },
    });
    await connecting;

    socket.serverEvent({
      type: "response.audio.delta",
      delta: "must-not-be-consumed",
    });

    expect(socket.closeCode).toBe(1008);
    expect(client.telemetry()).toMatchObject({
      protocolViolations: 1,
      lastEventType: "response.audio.delta",
    });
  });

  it("closes fail-open when the shadow server reports an error", async () => {
    const socket = new FakeSocket();
    const client = createClient(socket);
    const connecting = client.connect();
    socket.open();
    await waitForSessionUpdate(socket);
    socket.serverEvent({
      type: "session.updated",
      session: { modalities: ["text"] },
    });
    await connecting;

    socket.serverEvent({ type: "error", error: { message: "ignored" } });

    expect(socket.closeCode).toBe(1011);
    expect(client.telemetry()).toMatchObject({
      connected: false,
      lastErrorClass: "shadow_server_error",
    });
  });
});

async function waitForSessionUpdate(socket: FakeSocket) {
  for (let attempt = 0; attempt < 10 && socket.sent.length === 0; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(socket.sent).toHaveLength(1);
  expect(JSON.parse(socket.sent[0]!) as { type: string }).toMatchObject({
    type: "session.update",
  });
}

function createClient(socket: FakeSocket) {
  return new QwenAudioRealtimeShadowClient(
    config(),
    () => socket as unknown as QwenAudioShadowSocket,
  );
}

function config(): QwenAudioRealtimeShadowConfig {
  return {
    endpoint: "wss://workspace.example/api-ws/v1/realtime",
    apiKey: "test-secret",
    model: "qwen-audio-3.0-realtime-flash",
    maxBufferedAudioMs: 1_000,
    maxBufferedChunks: 4,
    connectTimeoutMs: 1_000,
  };
}

class FakeSocket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  sent: string[] = [];
  closeCode?: number;

  send(data: string) {
    this.sent.push(data);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  serverEvent(value: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(value)));
  }

  close(code?: number) {
    this.closeCode = code;
    this.readyState = 3;
    this.emit("close");
  }
}
