import type {
  AudioFrameSinkRequest,
  AudioFrameSinkResult,
  PstnAudioFrameSink,
  PstnBridgeEnv,
} from "./types.js";

export function buildAudioFrameSink(config: PstnBridgeEnv, fetchFn: typeof fetch = fetch): PstnAudioFrameSink {
  return config.audioFrameSinkEndpoint
    ? new HttpAudioFrameSink(config, fetchFn)
    : new NoopAudioFrameSink();
}

export class NoopAudioFrameSink implements PstnAudioFrameSink {
  async send(_request: AudioFrameSinkRequest): Promise<AudioFrameSinkResult> {
    return { status: "dropped" };
  }
}

export class HttpAudioFrameSink implements PstnAudioFrameSink {
  constructor(
    private readonly config: PstnBridgeEnv,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(request: AudioFrameSinkRequest): Promise<AudioFrameSinkResult> {
    const response = await this.fetchWithTimeout(this.config.audioFrameSinkEndpoint!, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `PSTN audio frame sink returned HTTP ${response.status}`);
    }
    return normalizeAudioFrameSinkResult(body);
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.audioFrameSinkTimeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.config.audioFrameSinkApiKey ? { authorization: `Bearer ${this.config.audioFrameSinkApiKey}` } : {}),
    };
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function normalizeAudioFrameSinkResult(body: unknown): AudioFrameSinkResult {
  if (!body || typeof body !== "object") return { status: "accepted" };
  const record = body as Record<string, unknown>;
  return {
    status: parseStatus(record.status),
    ...optional("acceptedFrameId", record.acceptedFrameId),
  };
}

function parseStatus(value: unknown): AudioFrameSinkResult["status"] {
  return value === "dropped" || value === "failed" ? value : "accepted";
}

function optional(name: string, value: unknown) {
  return typeof value === "string" && value.trim()
    ? { [name]: value.trim().slice(0, 160) }
    : {};
}
