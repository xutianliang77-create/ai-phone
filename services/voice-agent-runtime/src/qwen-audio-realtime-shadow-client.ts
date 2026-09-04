import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import type { QwenAudioRealtimeShadowConfig } from "./config.js";

const PCM_BYTES_PER_100_MS = 3_200;
const OPEN = 1;

export interface QwenAudioShadowTelemetry {
  connected: boolean;
  configured: boolean;
  audioChunksSent: number;
  audioChunksDropped: number;
  serverEvents: number;
  protocolViolations: number;
  lastEventType?: string;
  lastErrorClass?: string;
}

export interface QwenAudioShadowSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  once(event: "open", listener: () => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: () => void): this;
  on(event: "message", listener: (data: RawData) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: () => void): this;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type QwenAudioShadowSocketFactory = (
  url: string,
  apiKey: string,
) => QwenAudioShadowSocket;

export class QwenAudioRealtimeShadowClient {
  private socket?: QwenAudioShadowSocket;
  private connectPromise?: Promise<void>;
  private closed = false;
  private readonly counts = {
    connected: false,
    configured: false,
    audioChunksSent: 0,
    audioChunksDropped: 0,
    serverEvents: 0,
    protocolViolations: 0,
  };
  private lastEventType?: string;
  private lastErrorClass?: string;
  private configurationResolve?: () => void;
  private configurationReject?: (error: Error) => void;

  constructor(
    private readonly config: QwenAudioRealtimeShadowConfig,
    private readonly socketFactory: QwenAudioShadowSocketFactory =
      defaultSocketFactory,
    private readonly onTelemetry?: (value: QwenAudioShadowTelemetry) => void,
  ) {}

  connect() {
    if (this.closed) return Promise.reject(new Error("shadow_client_closed"));
    this.connectPromise ??= this.open();
    return this.connectPromise;
  }

  appendPcm100ms(pcm: Uint8Array) {
    const socket = this.socket;
    const maximumBufferedBytes = this.maximumBufferedBytes();
    if (pcm.byteLength !== PCM_BYTES_PER_100_MS || !socket ||
        socket.readyState !== OPEN || !this.counts.configured ||
        socket.bufferedAmount > maximumBufferedBytes - pcm.byteLength) {
      this.counts.audioChunksDropped += 1;
      this.emitTelemetry();
      return false;
    }
    try {
      socket.send(JSON.stringify({
        event_id: `event_${randomUUID()}`,
        type: "input_audio_buffer.append",
        audio: Buffer.from(pcm).toString("base64"),
      }));
      this.counts.audioChunksSent += 1;
      this.emitTelemetry();
      return true;
    } catch (error) {
      this.observeError(error);
      this.counts.audioChunksDropped += 1;
      this.close(1011, "shadow_send_failed");
      return false;
    }
  }

  telemetry(): QwenAudioShadowTelemetry {
    return {
      ...this.counts,
      ...(this.lastEventType ? { lastEventType: this.lastEventType } : {}),
      ...(this.lastErrorClass ? { lastErrorClass: this.lastErrorClass } : {}),
    };
  }

  close(code = 1000, reason = "shadow_closed") {
    if (this.closed) return;
    this.closed = true;
    this.counts.connected = false;
    this.rejectConfiguration(new Error("shadow_socket_closed"));
    const socket = this.socket;
    if (socket && (socket.readyState === 0 || socket.readyState === OPEN)) {
      try {
        socket.close(code, reason.slice(0, 120));
      } catch (error) {
        this.observeError(error);
      }
    }
    this.emitTelemetry();
  }

  private async open() {
    const endpoint = new URL(this.config.endpoint);
    endpoint.searchParams.set("model", this.config.model);
    const socket = this.socketFactory(endpoint.toString(), this.config.apiKey);
    this.socket = socket;
    socket.on("message", (data) => this.observeServerEvent(data));
    socket.on("error", (error) => {
      this.observeError(error);
      this.rejectConfiguration(error);
    });
    socket.on("close", () => {
      this.counts.connected = false;
      this.rejectConfiguration(new Error("shadow_socket_closed"));
      this.emitTelemetry();
    });
    try {
      await withTimeout(new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
        socket.once("close", () => reject(new Error("shadow_socket_closed")));
      }), this.config.connectTimeoutMs);
      if (this.closed || socket.readyState !== OPEN) {
        throw new Error("shadow_socket_closed");
      }
      this.counts.connected = true;
      const configured = new Promise<void>((resolve, reject) => {
        this.configurationResolve = resolve;
        this.configurationReject = reject;
      });
      socket.send(JSON.stringify({
        event_id: `event_${randomUUID()}`,
        type: "session.update",
        session: {
          modalities: ["text"],
          input_audio_format: "pcm",
          instructions: [
            "You are a passive call-audio quality observer.",
            "Never call tools, request actions, or produce audio.",
            "Your output is not a product response and must remain internal.",
          ].join(" "),
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            silence_duration_ms: 800,
          },
        },
      }));
      await withTimeout(configured, this.config.connectTimeoutMs);
    } catch (error) {
      this.observeError(error);
      this.close(1011, "shadow_connect_failed");
      throw error;
    }
  }

  private observeServerEvent(data: RawData) {
    let value: unknown;
    try {
      value = JSON.parse(rawDataToUtf8(data));
    } catch {
      this.protocolViolation("invalid_json");
      return;
    }
    if (!value || typeof value !== "object" || !("type" in value) ||
        typeof value.type !== "string") {
      this.protocolViolation("invalid_event");
      return;
    }
    const type = safeEventType(value.type);
    this.counts.serverEvents += 1;
    this.lastEventType = type;
    if (type === "session.updated") {
      if (!isTextOnlySession(value)) {
        this.protocolViolation("session_configuration_mismatch");
        return;
      }
      this.counts.configured = true;
      this.configurationResolve?.();
      this.clearConfigurationSettlement();
      this.emitTelemetry();
      return;
    }
    if (type === "response.audio.delta" || type.includes("function_call")) {
      this.protocolViolation(type);
      return;
    }
    if (type === "error") {
      this.lastErrorClass = "shadow_server_error";
      this.rejectConfiguration(new Error("shadow_server_error"));
      this.close(1011, "shadow_server_error");
      return;
    }
    this.emitTelemetry();
  }

  private protocolViolation(type: string) {
    this.counts.protocolViolations += 1;
    this.lastEventType = safeEventType(type);
    this.close(1008, "shadow_protocol_violation");
  }

  private rejectConfiguration(error: Error) {
    this.configurationReject?.(error);
    this.clearConfigurationSettlement();
  }

  private clearConfigurationSettlement() {
    this.configurationResolve = undefined;
    this.configurationReject = undefined;
  }

  private observeError(error: unknown) {
    this.lastErrorClass = safeErrorClass(error);
    this.emitTelemetry();
  }

  private maximumBufferedBytes() {
    const byDuration = Math.max(
      1,
      Math.floor(this.config.maxBufferedAudioMs / 100),
    ) * PCM_BYTES_PER_100_MS;
    return Math.min(
      byDuration,
      this.config.maxBufferedChunks * PCM_BYTES_PER_100_MS,
    );
  }

  private emitTelemetry() {
    this.onTelemetry?.(this.telemetry());
  }
}

function defaultSocketFactory(
  url: string,
  apiKey: string,
): QwenAudioShadowSocket {
  return new WebSocket(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

function rawDataToUtf8(data: RawData) {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function safeEventType(value: string) {
  return /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : "unknown_event";
}

function isTextOnlySession(value: object) {
  if (!("session" in value)) return false;
  const session = value.session;
  if (!session || typeof session !== "object" ||
      !("modalities" in session)) return false;
  const modalities = session.modalities;
  return Array.isArray(modalities) && modalities.length === 1 &&
    modalities[0] === "text";
}

function safeErrorClass(error: unknown) {
  const value = error instanceof Error ? error.name : "shadow_error";
  return /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) ? value : "shadow_error";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("shadow_connect_timeout")),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
