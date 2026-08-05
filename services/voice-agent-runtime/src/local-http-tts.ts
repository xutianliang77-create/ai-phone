import {
  APIConnectionError,
  type APIConnectOptions,
  APIError,
  APIStatusError,
  APITimeoutError,
  tts,
} from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { randomUUID } from "node:crypto";
import { writeLocalTtsEvidence } from "./local-tts-evidence.js";

const OUTPUT_SAMPLE_RATE = 24_000;

export interface LocalHttpTTSOptions {
  baseUrl: string;
  apiKey?: string;
  language: "zh" | "en";
  model: string;
  voice: string;
  timeoutMs: number;
  evidenceDir?: string;
  fetchFn?: typeof fetch;
}

export class LocalHttpTTS extends tts.TTS {
  readonly label = "local-http.TTS";

  constructor(readonly options: LocalHttpTTSOptions) {
    super(OUTPUT_SAMPLE_RATE, 1, { streaming: false, alignedTranscript: false });
  }

  override get model() {
    return this.options.model;
  }

  override get provider() {
    return "local_http";
  }

  synthesize(
    text: string,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ) {
    return new LocalHttpTtsChunkedStream(
      text,
      this,
      connOptions,
      abortSignal,
    );
  }

  stream(): tts.SynthesizeStream {
    throw new APIError("Local HTTP TTS is exposed through the chunked adapter", {
      retryable: false,
    });
  }
}

class LocalHttpTtsChunkedStream extends tts.ChunkedStream {
  readonly label = "local-http.ChunkedStream";

  constructor(
    text: string,
    private readonly client: LocalHttpTTS,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ) {
    super(text, client, connOptions, abortSignal);
  }

  protected async run() {
    const requestId = `voice-tts-${randomUUID()}`;
    const response = await requestTts(
      this.client.options,
      this.inputText,
      requestId,
      this.abortSignal,
    );
    let expectedSequence = 1;
    let pending: tts.SynthesizedAudio | undefined;
    let sawFinal = false;
    const evidenceChunks: Buffer[] = [];
    for await (const event of readNdjson(response)) {
      if (sawFinal) {
        throw invalidResponse("Local TTS returned data after final");
      }
      if (event.type === "metadata") continue;
      if (event.type === "final") {
        sawFinal = true;
        continue;
      }
      if (event.type !== "audio_chunk" || event.format !== "pcm16" ||
        event.sampleRate !== OUTPUT_SAMPLE_RATE ||
        event.sequence !== expectedSequence || typeof event.data !== "string") {
        throw invalidResponse("Local TTS returned an invalid audio chunk");
      }
      expectedSequence += 1;
      const bytes = decodeBase64Pcm(event.data);
      if (this.client.options.evidenceDir) evidenceChunks.push(Buffer.from(bytes));
      const audio = {
        requestId,
        segmentId: requestId,
        frame: new AudioFrame(
          pcmBytesToSamples(bytes),
          OUTPUT_SAMPLE_RATE,
          1,
          bytes.length / 2,
        ),
        final: false,
      } satisfies tts.SynthesizedAudio;
      if (pending) this.queue.put(pending);
      pending = audio;
    }
    if (!sawFinal || !pending) {
      throw invalidResponse("Local TTS stream ended without final audio");
    }
    if (this.client.options.evidenceDir) {
      await writeLocalTtsEvidence({
        directory: this.client.options.evidenceDir,
        requestId,
        text: this.inputText,
        pcm: Buffer.concat(evidenceChunks),
        sampleRate: OUTPUT_SAMPLE_RATE,
      });
    }
    this.queue.put({ ...pending, final: true });
  }
}

async function requestTts(
  options: LocalHttpTTSOptions,
  text: string,
  segmentId: string,
  signal: AbortSignal,
) {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  let response: Response;
  try {
    response = await (options.fetchFn ?? fetch)(
      `${options.baseUrl.replace(/\/+$/, "")}/tts/stream`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey
            ? { authorization: `Bearer ${options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          text,
          language: options.language,
          speakerRole: "host",
          segmentId,
          ...(options.voice === "default" ? {} : {
            voice: { mode: "preset", presetId: options.voice },
          }),
        }),
        signal: AbortSignal.any([signal, timeoutSignal]),
      },
    );
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new APITimeoutError({ message: "Local TTS request timed out" });
    }
    throw new APIConnectionError({
      message: `Local TTS request failed: ${errorMessage(error)}`,
    });
  }
  if (!response.ok) {
    throw new APIStatusError({
      message: `Local TTS returned HTTP ${response.status}`,
      options: {
        statusCode: response.status,
        requestId: response.headers.get("x-request-id"),
        retryable: response.status >= 500,
      },
    });
  }
  if (!response.body) throw invalidResponse("Local TTS returned an empty body");
  return response;
}

async function* readNdjson(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield parseEvent(trimmed);
      }
      if (done) {
        const trimmed = pending.trim();
        if (trimmed) yield parseEvent(trimmed);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(line: string): Record<string, unknown> {
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("event must be an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw invalidResponse("Local TTS returned invalid NDJSON");
  }
}

function decodeBase64Pcm(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length % 2 !== 0 ||
    bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw invalidResponse("Local TTS returned invalid PCM16 base64");
  }
  return bytes;
}

function pcmBytesToSamples(bytes: Buffer) {
  const samples = new Int16Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2);
  }
  return samples;
}

function invalidResponse(message: string) {
  return new APIError(message, { retryable: false });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
