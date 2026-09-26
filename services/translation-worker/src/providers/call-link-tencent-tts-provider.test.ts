import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CallLinkPublicTtsAttemptEvent,
  CallLinkPublicTtsMaterial,
} from "@translation/contracts";
import type WebSocket from "ws";
import { CallLinkTencentTtsProvider } from "./call-link-tencent-tts-provider.js";
import type { WorkerDispatchRuntimeClient } from
  "../livekit-agent/worker-dispatch-runtime-client.js";

const ticket = {
  v: 1 as const,
  callId: "call-1",
  sessionId: "call-1",
  roomName: "call_call-1",
  agentName: "translation-runtime",
  generation: 2,
  nonce: "nonce-1",
  iat: 1,
  exp: 2,
  ticket: "synthetic.ticket",
};

const profile = {
  providerId: "tencent" as const,
  protocol: "tencent_tts_ws" as const,
  endpoint: "wss://tts.cloud.tencent.com/stream_wsv2",
  modelId: "service:tencent_tts_ws",
  appId: "10001",
  voice: "101001",
  volume: 4,
  timeoutMs: 500,
  sampleRate: 16000 as const,
};

describe("CallLinkTencentTtsProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("obtains generation-bound material only at synthesis, journals before text, and confirms after final PCM", async () => {
    const socket = new SyntheticTencentSpeechSocket("placeholder");
    const client = fakeClient();
    const provider = new CallLinkTencentTtsProvider({
      client,
      ticket,
      participantIdentity: "call-1:worker:one",
      workerId: "worker-1",
      jobId: "job-1",
      credentialAccessSecret: "x".repeat(32),
      profile,
      socketFactory: (url) => {
        socket.wireId = new URL(url).searchParams.get("SessionId")!;
        socket.start();
        return socket.asWebSocket();
      },
    });

    expect((provider as { warmup?: unknown }).warmup).toBeUndefined();
    await provider.createCall("call-1");
    const events = [];
    for await (const event of provider.synthesizeStream!({
      callId: "call-1",
      text: "Hello world.",
      language: "en",
      speakerRole: "host",
      segmentId: "segment-1",
      speechId: "speech-1",
      turnId: "turn-1",
      revision: 1,
      pipelineGeneration: 1,
      voice: { mode: "preset", presetId: "101001", quality: "standard" },
      signal: new AbortController().signal,
    })) events.push(event);

    expect(client.ttsMaterial).toHaveBeenCalledTimes(1);
    expect(client.recordTtsAttempt.mock.calls.map((call) => call[0].event.state))
      .toEqual(["dispatching", "confirmed"]);
    expect(socket.sent.map((event) => event.action)).toEqual([
      "ACTION_SYNTHESIS",
      "ACTION_COMPLETE",
    ]);
    expect(client.recordTtsAttempt.mock.calls[0][0].event).not.toHaveProperty("text");
    expect(client.recordTtsAttempt.mock.calls[1][0].event).toMatchObject({
      metadata: { requestId: "tencent-request", usage: { billedCharacters: 12 } },
    });
    expect(events.map((event) => event.type)).toEqual([
      "metadata",
      "audio_chunk",
      "final",
    ]);
    expect(events[1]).toMatchObject({
      type: "audio_chunk",
      sequence: 1,
      audio: { format: "pcm16", sampleRate: 16000 },
    });
  });

  it("does not send a provider request when the material profile differs", async () => {
    const client = fakeClient({
      ...material(),
      profile: { ...profile, voice: "101002" },
    });
    const provider = new CallLinkTencentTtsProvider({
      client,
      ticket,
      participantIdentity: "call-1:worker:one",
      workerId: "worker-1",
      jobId: "job-1",
      credentialAccessSecret: "x".repeat(32),
      profile,
    });

    await expect(collect(provider)).rejects.toThrow("profile changed");
    expect(client.recordTtsAttempt).not.toHaveBeenCalled();
  });

  it("records uncertain when a provider close follows submitted audio", async () => {
    const socket = new SyntheticTencentSpeechSocket("placeholder");
    socket.autoFinal = false;
    const client = fakeClient();
    const provider = new CallLinkTencentTtsProvider({
      client,
      ticket,
      participantIdentity: "call-1:worker:one",
      workerId: "worker-1",
      jobId: "job-1",
      credentialAccessSecret: "x".repeat(32),
      profile,
      socketFactory: (url) => {
        socket.wireId = new URL(url).searchParams.get("SessionId")!;
        socket.onSend = (event) => {
          if (event.action === "ACTION_COMPLETE") queueMicrotask(() => socket.terminate());
        };
        socket.start();
        return socket.asWebSocket();
      },
    });

    await expect(collect(provider)).rejects.toThrow("tencent_tts");
    expect(client.recordTtsAttempt.mock.calls.map((call) => call[0].event.state))
      .toEqual(["dispatching", "uncertain"]);
  });

  it("does not acquire material or prepare an attempt for cancelled input", async () => {
    const client = fakeClient();
    const socketFactory = vi.fn();
    const provider = providerFor(client, socketFactory);
    const controller = new AbortController();
    controller.abort();
    const stream = provider.synthesizeStream(synthesisInput(controller.signal))[Symbol.asyncIterator]();
    await expect(stream.next()).rejects.toThrow("call_link_tencent_tts_cancelled");
    expect(client.ttsMaterial).not.toHaveBeenCalled();
    expect(client.recordTtsAttempt).not.toHaveBeenCalled();
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it("releases the abort listener even if a consumer-stop receipt cannot persist", async () => {
    const client = fakeClient();
    client.recordTtsAttempt.mockImplementation(async (request: {event:CallLinkPublicTtsAttemptEvent}) => {
      if (request.event.state !== "dispatching") throw Error("receipt_unavailable");
      return {event:request.event,recordedAt:"2026-09-20T00:00:00.000Z",costStatus:"unknown"};
    });
    const socketFactory = vi.fn();
    const provider = providerFor(client, socketFactory);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const stream = provider.synthesizeStream(synthesisInput(controller.signal))[Symbol.asyncIterator]();
    expect((await stream.next()).value).toMatchObject({type:"metadata"});
    await expect(stream.return!()).rejects.toThrow("receipt_unavailable");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(socketFactory).not.toHaveBeenCalled();
    expect(client.recordTtsAttempt.mock.calls.map(call => call[0].event.state))
      .toEqual(["dispatching","not_sent","not_sent"]);
  });

  it.each([false, true])("retries the exact confirmed receipt without resynthesis (persistent failure %s)", async persistent => {
    const socket = new SyntheticTencentSpeechSocket("placeholder");
    const client = fakeClient();
    let confirmedCalls = 0;
    client.recordTtsAttempt.mockImplementation(async (request: {event:CallLinkPublicTtsAttemptEvent}) => {
      if (request.event.state === "confirmed" && (++confirmedCalls === 1 || persistent)) {
        throw Error("confirmed_ack_lost");
      }
      return {event:request.event,recordedAt:"2026-09-20T00:00:00.000Z",costStatus:"unknown"};
    });
    const provider = providerFor(client, url => {
      socket.wireId = new URL(url).searchParams.get("SessionId")!;
      socket.start();
      return socket.asWebSocket();
    });
    if (persistent) await expect(collect(provider)).rejects.toThrow("confirmed_ack_lost");
    else expect((await collect(provider)).at(-1)).toMatchObject({type:"final"});
    const events = client.recordTtsAttempt.mock.calls.map(call => call[0].event);
    expect(events.map(event => event.state)).toEqual(["dispatching","confirmed","confirmed"]);
    expect(events[1]).toEqual(events[2]);
    expect(socket.sent.filter(event => event.action === "ACTION_SYNTHESIS")).toHaveLength(1);
    expect(socket.readyState).toBe(3);
  });
});

async function collect(provider: CallLinkTencentTtsProvider) {
  const events = [];
  for await (const event of provider.synthesizeStream!(synthesisInput())) events.push(event);
  return events;
}

function synthesisInput(signal = new AbortController().signal): Parameters<CallLinkTencentTtsProvider["synthesize"]>[0] {
  return {
    callId: "call-1",
    text: "Hello world.",
    language: "en",
    speakerRole: "host",
    segmentId: "segment-1",
    speechId: "speech-1",
    turnId: "turn-1",
    revision: 1,
    pipelineGeneration: 1,
    voice: { mode: "preset", presetId: "101001", quality: "standard" },
    signal,
  };
}

function providerFor(client: WorkerDispatchRuntimeClient,
    socketFactory: NonNullable<ConstructorParameters<typeof CallLinkTencentTtsProvider>[0]["socketFactory"]>) {
  return new CallLinkTencentTtsProvider({client,ticket,profile,socketFactory,
    participantIdentity:"call-1:worker:one",workerId:"worker-1",jobId:"job-1",
    credentialAccessSecret:"x".repeat(32)});
}

function material(): CallLinkPublicTtsMaterial {
  return {
    callId: "call-1",
    sessionId: "call-1",
    generation: 2,
    workerId: "worker-1",
    jobId: "job-1",
    profile,
    credentials: { secretId: "SYNTHETIC_ID", secretKey: "SYNTHETIC_KEY" },
  };
}

function fakeClient(value = material()) {
  return {
    ttsMaterial: vi.fn(async () => structuredClone(value)),
    recordTtsAttempt: vi.fn(async (_input: { event: CallLinkPublicTtsAttemptEvent }) => ({
      event: _input.event,
      recordedAt: "2026-09-20T00:00:00.000Z",
      costStatus: "unknown" as const,
    })),
  } as unknown as WorkerDispatchRuntimeClient & {
    ttsMaterial: ReturnType<typeof vi.fn>;
    recordTtsAttempt: ReturnType<typeof vi.fn>;
  };
}

class SyntheticTencentSpeechSocket extends EventEmitter {
  readyState = 0;
  bufferedAmount = 0;
  sent: Array<Record<string, unknown>> = [];
  autoFinal = true;
  wireId: string;
  onSend?: (event: Record<string, unknown>) => void;
  private messageId = 0;

  constructor(wireId: string) {
    super();
    this.wireId = wireId;
  }

  start() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open");
      this.control();
      this.control({ ready: 1 });
    });
  }

  send(raw: string, callback: (error?: Error) => void) {
    const event = JSON.parse(raw) as Record<string, unknown>;
    this.sent.push(event);
    callback();
    this.onSend?.(event);
    if (event.action === "ACTION_SYNTHESIS") queueMicrotask(() => this.audio());
    if (event.action === "ACTION_COMPLETE" && this.autoFinal) {
      queueMicrotask(() => this.control({ final: 1 }));
    }
  }

  control(overrides: Record<string, unknown> = {}) {
    this.emit("message", Buffer.from(JSON.stringify({
      code: 0,
      message: "success",
      session_id: this.wireId,
      request_id: "tencent-request",
      message_id: `message-${++this.messageId}`,
      ready: 0,
      final: 0,
      heartbeat: 0,
      result: { subtitles: null },
      ...overrides,
    })), false);
  }

  audio() {
    this.emit("message", Buffer.alloc(1920), true);
  }

  terminate() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close");
  }

  asWebSocket() {
    return this as unknown as WebSocket;
  }
}
