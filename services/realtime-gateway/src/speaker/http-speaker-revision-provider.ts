import type {
  SpeakerRevisionProvider,
  SpeakerRevisionRequest,
  SpeakerRevisionResult,
  SpeakerRevisionSpan,
} from "./speaker-revision-provider.js";

export class HttpSpeakerRevisionProvider implements SpeakerRevisionProvider {
  constructor(private readonly options: {
    endpoint: string;
    healthUrl?: string;
    apiKey?: string;
    timeoutMs: number;
  }) {}

  async revise(request: SpeakerRevisionRequest) {
    const response = await this.request(this.options.endpoint, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const detail = await boundedErrorDetail(response);
      throw new Error(
        `Speaker revision failed with HTTP ${response.status}` +
          (detail ? `: ${detail}` : ""),
      );
    }
    return parseRevisionResult(await response.json(), request);
  }

  async healthCheck() {
    const healthUrl = this.options.healthUrl;
    if (!healthUrl) return true;
    try {
      const response = await this.request(healthUrl, {
        headers: this.headers(false),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private headers(json = true) {
    return {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(this.options.apiKey
        ? { authorization: `Bearer ${this.options.apiKey}` }
        : {}),
    };
  }

  private async request(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function boundedErrorDetail(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let byteCount = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > 4_096) {
        await reader.cancel();
        return undefined;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!record(parsed)) return undefined;
    return normalizedErrorDetail(parsed.detail);
  } catch {
    return undefined;
  }
}

function normalizedErrorDetail(value: unknown) {
  if (typeof value === "string") return normalizedText(value);
  const first = Array.isArray(value) ? value[0] : undefined;
  if (!record(first) || typeof first.msg !== "string") return undefined;
  const location = Array.isArray(first.loc)
    ? first.loc.filter((part) =>
      typeof part === "string" || typeof part === "number"
    ).join(".")
    : "request";
  return normalizedText(`${location || "request"}: ${first.msg}`);
}

function normalizedText(value: string) {
  const detail = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return detail ? detail.slice(0, 160) : undefined;
}

function parseRevisionResult(
  value: unknown,
  request: SpeakerRevisionRequest,
): SpeakerRevisionResult {
  if (!record(value)) throw new Error("Speaker revision response is malformed");
  const spans = Array.isArray(value.spans) && value.spans.length <= 4_096
    ? value.spans.map(parseSpan)
    : null;
  if (
    value.sessionId !== request.sessionId ||
    value.generation !== request.generation ||
    value.windowStartMs !== request.windowStartMs ||
    value.windowEndMs !== request.windowEndMs ||
    !metadataId(value.provider, 80) ||
    !(value.model === undefined || metadataId(value.model, 160)) ||
    !positiveInteger(value.speakerCount) ||
    spans === null
  ) {
    throw new Error("Speaker revision response does not match its request");
  }
  return {
    sessionId: request.sessionId,
    generation: request.generation,
    windowStartMs: request.windowStartMs,
    windowEndMs: request.windowEndMs,
    provider: value.provider,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    speakerCount: value.speakerCount,
    spans,
    ...(nonNegative(value.latencyMs) ? { latencyMs: value.latencyMs } : {}),
  };
}

function parseSpan(value: unknown): SpeakerRevisionSpan {
  if (
    !record(value) ||
    typeof value.speakerId !== "string" ||
    !nonNegative(value.startMs) ||
    !nonNegative(value.endMs) ||
    value.endMs <= value.startMs ||
    !(value.confidence === undefined || ratio(value.confidence)) ||
    !(value.overlap === undefined || typeof value.overlap === "boolean")
  ) {
    throw new Error("Speaker revision span is malformed");
  }
  return {
    speakerId: value.speakerId,
    startMs: value.startMs,
    endMs: value.endMs,
    ...(typeof value.confidence === "number"
      ? { confidence: value.confidence }
      : {}),
    ...(typeof value.overlap === "boolean" ? { overlap: value.overlap } : {}),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function ratio(value: unknown): value is number {
  return nonNegative(value) && value <= 1;
}

function metadataId(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= maxLength && /^[A-Za-z0-9._:/-]+$/.test(value);
}
