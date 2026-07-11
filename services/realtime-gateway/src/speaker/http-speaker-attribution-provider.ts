import type { AudioFrame } from "@translation/contracts";
import type {
  SpeakerAttributionProvider,
  SpeakerSessionInput,
  SpeakerSpan,
} from "./speaker-attribution-provider.js";

export interface HttpSpeakerAttributionProviderOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class HttpSpeakerAttributionProvider
  implements SpeakerAttributionProvider {
  readonly name = "http_streaming_diarization";
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpSpeakerAttributionProviderOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createSession(input: SpeakerSessionInput) {
    await this.request("/speaker/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async pushAudio(frame: AudioFrame) {
    const response = await this.request("/speaker/frames", {
      method: "POST",
      body: JSON.stringify(frame),
    });
    return parseSpans(await response.json());
  }

  async flush(sessionId: string) {
    const response = await this.request(
      `/speaker/sessions/${encodeURIComponent(sessionId)}/flush`,
      { method: "POST" },
    );
    return parseSpans(await response.json());
  }

  async closeSession(sessionId: string) {
    await this.request(`/speaker/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  async healthCheck() {
    try {
      await this.request("/health", { method: "GET" });
      return true;
    } catch {
      return false;
    }
  }

  private async request(path: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.options.baseUrl.replace(/\/$/u, "")}${path}`,
        {
          ...init,
          headers: {
            "content-type": "application/json",
            ...(this.options.apiKey
              ? { authorization: `Bearer ${this.options.apiKey}` }
              : {}),
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Speaker provider returned HTTP ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseSpans(value: unknown): SpeakerSpan[] {
  const spans = (value as { spans?: unknown })?.spans;
  if (!Array.isArray(spans)) return [];
  return spans.filter(isSpeakerSpan);
}

function isSpeakerSpan(value: unknown): value is SpeakerSpan {
  if (!value || typeof value !== "object") return false;
  const span = value as Partial<SpeakerSpan>;
  return typeof span.speakerId === "string" &&
    typeof span.startMs === "number" &&
    typeof span.endMs === "number" &&
    span.startMs >= 0 && span.endMs >= span.startMs;
}
