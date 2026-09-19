import { createHmac, randomUUID } from "node:crypto";
import WebSocket from "ws";

export interface TencentTtsWireOptions {
  endpoint: string;
  appId?: string;
  voice: string;
  targetLanguage: string;
  timeoutMs: number;
  sampleRate?: 16000 | 24000;
  volume?: number;
  socketFactory?: (
    url: string,
    options: WebSocket.ClientOptions,
  ) => WebSocket;
}

export interface TencentTtsWireCredentials {
  secretId?: string;
  secretKey?: string;
}

export interface TencentTtsWireMetadata {
  requestId?: string;
}

export class TencentTtsWireError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: "not_sent" | "uncertain",
  ) {
    super(code);
  }
}

const key = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,240}$/.test(value);
const integer = (value: unknown) =>
  typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) &&
  Number.isSafeInteger(Number(value));

export function validateTencentTtsWire(options: TencentTtsWireOptions) {
  let url: URL;
  try {
    url = new URL(options.endpoint);
  } catch {
    throw new TencentTtsWireError("tencent_tts_configuration", "not_sent");
  }
  if (
    url.protocol !== "wss:" || url.pathname !== "/stream_wsv2" ||
    url.username || url.password || url.search || url.hash ||
    !integer(options.appId) || !integer(options.voice) ||
    options.voice === "200000000" ||
    ![16000, 24000].includes(options.sampleRate ?? 24000) ||
    !["zh", "en"].includes(options.targetLanguage) ||
    !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 250 ||
    options.timeoutMs > 120000 ||
    (options.volume !== undefined &&
      (!Number.isFinite(options.volume) || options.volume < -10 ||
        options.volume > 10))
  ) {
    throw new TencentTtsWireError("tencent_tts_configuration", "not_sent");
  }
}

/**
 * The signed URL lives only in the transport process. It contains a SecretId
 * and an expiring signature, so callers must neither log nor persist it.
 * SecretKey and synthesis text are never URL parameters.
 */
export function createTencentTtsWireUrl(
  options: TencentTtsWireOptions,
  credentials: TencentTtsWireCredentials,
  wireId: string,
  now = Date.now(),
) {
  validateTencentTtsWire(options);
  if (
    !key(credentials.secretId) || typeof credentials.secretKey !== "string" ||
    !credentials.secretKey || credentials.secretKey.length > 4096 ||
    credentials.secretKey.trim() !== credentials.secretKey ||
    /[\u0000-\u001f\u007f]/u.test(credentials.secretKey) || !key(wireId) ||
    !Number.isFinite(now) || now < 0
  ) {
    throw new TencentTtsWireError(
      "tencent_tts_credentials_unavailable",
      "not_sent",
    );
  }
  const url = new URL(options.endpoint);
  const timestamp = Math.floor(now / 1000);
  const params: Record<string, string> = {
    Action: "TextToStreamAudioWSv2",
    AppId: options.appId!,
    Codec: "pcm",
    Expired: String(timestamp + Math.ceil(options.timeoutMs / 1000) + 30),
    SampleRate: String(options.sampleRate ?? 24000),
    SecretId: credentials.secretId,
    SessionId: wireId,
    Timestamp: String(timestamp),
    VoiceType: options.voice,
    Volume: String(options.volume ?? 0),
  };
  const entries = Object.entries(params).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const canonical = entries.map(([name, value]) => `${name}=${value}`).join("&");
  const signature = createHmac("sha1", credentials.secretKey)
    .update(`GET${url.host}${url.pathname}?${canonical}`)
    .digest("base64");
  url.search = entries.map(([name, value]) =>
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`
  ).join("&") + `&Signature=${encodeURIComponent(signature)}`;
  return url.toString();
}

/**
 * Shared Stream-WSv2 transport. Provider-facing adapters own durable intent
 * and attempt accounting; this layer only validates the signed WebSocket wire
 * and returns bounded PCM bytes.
 */
export async function* streamTencentTtsPcm(
  options: TencentTtsWireOptions,
  text: string,
  credentials: TencentTtsWireCredentials,
  signal: AbortSignal,
  markSent: () => void,
  metadata: TencentTtsWireMetadata,
): AsyncIterable<Buffer> {
  const wireId = randomUUID();
  const url = createTencentTtsWireUrl(options, credentials, wireId);
  let ws: WebSocket | undefined;
  let failure: TencentTtsWireError | undefined;
  let wake = () => {};
  let ready = false;
  let submitted = false;
  let completing = false;
  let finished = false;
  let requestId: string | undefined;
  let queuedBytes = 0;
  let totalBytes = 0;
  const queue: Buffer[] = [];
  const seen = new Set<string>();
  const rate = options.sampleRate ?? 24000;
  const fail = (code: string) => {
    if (failure) return;
    failure = new TencentTtsWireError(code, submitted ? "uncertain" : "not_sent");
    wake();
    ws?.terminate();
  };
  const check = () => {
    if (signal.aborted) fail("tencent_tts_cancelled");
    if (failure) throw failure;
  };
  const wait = async (predicate: () => boolean) => {
    while (!predicate()) {
      check();
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    check();
  };
  const send = async (action: string, data: string) => {
    check();
    if (ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1048576) {
      throw new TencentTtsWireError(
        "tencent_tts_backpressure",
        submitted ? "uncertain" : "not_sent",
      );
    }
    await abortable(new Promise<void>((resolve, reject) => {
      ws!.send(
        JSON.stringify({
          session_id: wireId,
          message_id: randomUUID(),
          action,
          data,
        }),
        (error) => error ? reject(Error("send")) : resolve(),
      );
    }), signal);
  };
  const cancel = () => fail("tencent_tts_cancelled");
  signal.addEventListener("abort", cancel, { once: true });
  try {
    check();
    ws = (options.socketFactory ?? ((value, config) => new WebSocket(value, config)))(
      url,
      {
        handshakeTimeout: options.timeoutMs,
        maxPayload: 262144,
        perMessageDeflate: false,
        followRedirects: false,
      },
    );
    ws.on("error", () => fail("tencent_tts_transport_failed"));
    ws.on("close", () => {
      if (!finished) fail("tencent_tts_incomplete");
    });
    ws.on("message", (data, isBinary) => {
      if (failure) return;
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as Uint8Array);
        if (bytes.length > 262144) throw Error();
        if (isBinary) {
          if (!ready || !submitted || finished || !bytes.length) throw Error();
          queuedBytes += bytes.length;
          totalBytes += bytes.length;
          if (queuedBytes > rate * 2 * 10 || totalBytes > rate * 2 * 120 ||
            queue.length >= 256) {
            throw Error();
          }
          queue.push(bytes);
        } else {
          const event = JSON.parse(bytes.toString());
          if (
            !event || Array.isArray(event) || !Number.isInteger(event.code) ||
            event.session_id !== wireId || !key(event.request_id) ||
            !key(event.message_id) || seen.has(event.message_id) ||
            seen.size >= 4096 || ![0, 1].includes(event.final) ||
            ![0, 1].includes(event.ready ?? 0) ||
            ![0, 1].includes(event.heartbeat ?? 0) ||
            (event.ready ?? 0) + (event.heartbeat ?? 0) + event.final > 1 ||
            (requestId && requestId !== event.request_id) || finished
          ) {
            throw Error();
          }
          requestId = event.request_id;
          seen.add(event.message_id);
          // Tencent's textual diagnostic can include provider details. The
          // safe, stable diagnostic boundary is the numeric result code only.
          if (event.code !== 0) {
            fail(`tencent_tts_provider_${event.code}`);
            return;
          }
          if (event.ready === 1) {
            if (ready || submitted) throw Error();
            ready = true;
          }
          if (event.final === 1) {
            if (!completing || !submitted || totalBytes < 2 || totalBytes % 2) {
              throw Error();
            }
            finished = true;
            metadata.requestId = requestId;
          }
        }
        wake();
      } catch {
        fail("tencent_tts_protocol_failed");
      }
    });
    await wait(() => ready);
    check();
    submitted = true;
    markSent();
    await send("ACTION_SYNTHESIS", text);
    completing = true;
    await send("ACTION_COMPLETE", "");
    while (!finished || queue.length) {
      await wait(() => queue.length > 0 || finished);
      while (queue.length) {
        check();
        const bytes = queue.shift()!;
        queuedBytes -= bytes.length;
        yield bytes;
      }
    }
    check();
  } finally {
    signal.removeEventListener("abort", cancel);
    ws?.terminate();
    queue.length = 0;
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let listener = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
