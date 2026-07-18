import type {
  AsrEndpointMode,
  CallRoomTranslationLanguage,
  LanguageCode,
} from "@translation/contracts";
import type {
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallVadDecision,
  TranscriptSegment,
} from "../worker/types.js";

export interface AsrWebSocketLike {
  readonly readyState: number;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: Event | MessageEvent) => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: Event | MessageEvent) => void,
  ): void;
}

export type AsrWebSocketFactory = (url: string) => AsrWebSocketLike;

export interface PersistentAsrStreamOptions {
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
  endpointMode: AsrEndpointMode;
  hotwords: string[];
  corrections: Array<{ fromText: string; toText: string }>;
  webSocketFactory?: AsrWebSocketFactory;
}

interface PendingRequest {
  resolve: (message: AsrStreamResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface AsrStreamResponse {
  type: "session.ready" | "asr.result" | "session.flushed" | "session.closed";
  requestId?: string;
  sequence?: number;
  transcript?: TranscriptSegment | null;
  vadDecision?: Omit<CallVadDecision, "callId" | "speakerRole"> | null;
}

export class PersistentAsrStream {
  private socket?: AsrWebSocketLike;
  private opening?: Promise<void>;
  private requestCounter = 0;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly callId: string,
    private readonly speakerRole: CallAudioSpeakerRole,
    private readonly options: PersistentAsrStreamOptions,
  ) {}

  async transcribe(frame: CallAudioFrame) {
    const requestId = this.nextRequestId("frame");
    const response = await this.request(requestId, () =>
      encodeAudioFrame({
        type: "audio.frame",
        requestId,
        sequence: frame.sequence,
        timestampMs: frame.timestampMs,
        format: frame.format,
        sampleRate: frame.sampleRate,
      }, Buffer.from(frame.data, "base64"))
    );
    return response;
  }

  async flush() {
    const requestId = this.nextRequestId("flush");
    return this.request(requestId, () => JSON.stringify({
      type: "session.flush",
      requestId,
    }));
  }

  async close() {
    const socket = this.socket;
    this.socket = undefined;
    this.opening = undefined;
    if (!socket || socket.readyState > 1) return;
    try {
      const requestId = this.nextRequestId("close");
      await this.requestOnSocket(socket, requestId, JSON.stringify({
        type: "session.close",
        requestId,
      }));
    } finally {
      socket.close(1000, "call ended");
      this.rejectPending(new Error("ASR stream closed"));
    }
  }

  reset(error = new Error("ASR stream disconnected")) {
    const socket = this.socket;
    this.socket = undefined;
    this.opening = undefined;
    this.rejectPending(error);
    if (socket && socket.readyState < 2) {
      socket.close(1012, "stream reset");
    }
  }

  private async request(
    requestId: string,
    payload: () => string | Uint8Array,
  ) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const socket = await this.ensureOpen();
        return await this.requestOnSocket(socket, requestId, payload());
      } catch (error) {
        lastError = error;
        this.reset(asError(error));
      }
    }
    throw asError(lastError);
  }

  private async requestOnSocket(
    socket: AsrWebSocketLike,
    requestId: string,
    payload: string | Uint8Array,
  ) {
    const result = new Promise<AsrStreamResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`ASR stream request timed out: ${requestId}`));
      }, this.options.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    try {
      socket.send(payload);
      return await result;
    } catch (error) {
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
      }
      throw error;
    }
  }

  private ensureOpen() {
    if (this.socket?.readyState === 1) return Promise.resolve(this.socket);
    if (!this.opening) this.opening = this.open();
    return this.opening.then(() => {
      if (!this.socket || this.socket.readyState !== 1) {
        throw new Error("ASR stream did not open");
      }
      return this.socket;
    });
  }

  private open() {
    const socket = (this.options.webSocketFactory ?? defaultWebSocketFactory)(
      this.options.endpoint,
    );
    this.socket = socket;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.close(4000, "open timeout");
        reject(new Error("ASR stream open timed out"));
      }, this.options.timeoutMs);
      const onOpen = () => {
        socket.send(JSON.stringify({
          type: "session.open",
          sessionId: `${this.callId}:${this.speakerRole}`,
          ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
          sourceLanguage: "auto" satisfies LanguageCode,
          targetLanguage: "zh" satisfies CallRoomTranslationLanguage,
          mode: this.options.endpointMode,
          hotwords: this.options.hotwords,
          corrections: this.options.corrections,
        }));
      };
      const onMessage = (event: Event | MessageEvent) => {
        const message = parseMessageData((event as MessageEvent).data);
        if (!message) return;
        if (message.type === "session.ready") {
          cleanup();
          resolve();
          return;
        }
        this.resolvePending(message);
      };
      const onError = () => {
        cleanup();
        reject(new Error("ASR stream failed to open"));
      };
      const onClose = () => {
        cleanup(true);
        this.reset();
        reject(new Error("ASR stream closed before ready"));
      };
      const cleanup = (removeClose = false) => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
        if (removeClose) socket.removeEventListener("close", onClose);
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
    });
  }

  private resolvePending(message: AsrStreamResponse) {
    if (!message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    pending.resolve(message);
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private nextRequestId(kind: string) {
    this.requestCounter += 1;
    return `${kind}:${this.speakerRole}:${this.requestCounter}`;
  }
}

export function encodeAudioFrame(
  header: Record<string, unknown>,
  pcm: Uint8Array,
) {
  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8");
  const payload = Buffer.allocUnsafe(4 + encodedHeader.byteLength + pcm.byteLength);
  payload.writeUInt32BE(encodedHeader.byteLength, 0);
  encodedHeader.copy(payload, 4);
  Buffer.from(pcm).copy(payload, 4 + encodedHeader.byteLength);
  return payload;
}

function defaultWebSocketFactory(url: string): AsrWebSocketLike {
  return new WebSocket(url) as unknown as AsrWebSocketLike;
}

function parseMessageData(data: unknown): AsrStreamResponse | null {
  try {
    const text = typeof data === "string"
      ? data
      : data instanceof ArrayBuffer
      ? Buffer.from(data).toString("utf8")
      : ArrayBuffer.isView(data)
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8")
      : "";
    if (!text) return null;
    return JSON.parse(text) as AsrStreamResponse;
  } catch {
    return null;
  }
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
