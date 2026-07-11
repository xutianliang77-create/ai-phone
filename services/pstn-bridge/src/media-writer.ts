import type {
  MediaWriteRequest,
  MediaWriteResult,
  PstnBridgeEnv,
  PstnMediaWriter,
} from "./types.js";

export function buildMediaWriter(config: PstnBridgeEnv, fetchFn: typeof fetch = fetch): PstnMediaWriter {
  return config.mediaWriterEndpoint
    ? new HttpMediaWriter(config, fetchFn)
    : new NoopMediaWriter();
}

export class NoopMediaWriter implements PstnMediaWriter {
  async write(_request: MediaWriteRequest): Promise<MediaWriteResult> {
    return {};
  }
}

export class HttpMediaWriter implements PstnMediaWriter {
  constructor(
    private readonly config: PstnBridgeEnv,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async write(request: MediaWriteRequest): Promise<MediaWriteResult> {
    if (!request.mediaStreamId) {
      throw new Error("PSTN media writer missing mediaStreamId");
    }
    const response = await this.fetchWithTimeout(this.config.mediaWriterEndpoint!, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `PSTN media writer returned HTTP ${response.status}`);
    }
    return normalizeMediaWriteResult(body);
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mediaWriterTimeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.config.mediaWriterApiKey ? { authorization: `Bearer ${this.config.mediaWriterApiKey}` } : {}),
    };
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function normalizeMediaWriteResult(body: unknown): MediaWriteResult {
  if (!body || typeof body !== "object") return {};
  const mediaWriteId = (body as Record<string, unknown>).mediaWriteId;
  return typeof mediaWriteId === "string" && mediaWriteId.trim()
    ? { mediaWriteId: mediaWriteId.trim().slice(0, 160) }
    : {};
}
