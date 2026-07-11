import type {
  AgentCallBridgeRequest,
  AgentCallBridgeResult,
  PstnBridgeEnv,
  PstnMediaWriter,
  PstnProvider,
  TtsAudioSinkRequest,
  TtsAudioSinkResult,
} from "./types.js";
import { toTelephonyMulaw8k } from "./audio-codec.js";
import { FonosterPstnProvider } from "./fonoster-provider.js";
import { buildMediaWriter } from "./media-writer.js";

export function buildPstnProvider(config: PstnBridgeEnv, fetchFn: typeof fetch = fetch) {
  if (config.provider === "http") return new HttpPstnProvider(config, fetchFn);
  if (config.provider === "fonoster") return new FonosterPstnProvider(config, fetchFn);
  return new MockPstnProvider();
}

export class MockPstnProvider implements PstnProvider {
  async placeCall(request: AgentCallBridgeRequest): Promise<AgentCallBridgeResult> {
    return {
      status: "in_progress",
      providerCallId: `mock-pstn-${request.callId}`,
      nextStep: "mock PSTN Bridge 已接收任务，真实环境需替换为服务商拨号。",
    };
  }

  async playTranslatedAudio(request: TtsAudioSinkRequest): Promise<TtsAudioSinkResult> {
    return {
      status: "queued",
      providerPlaybackId: `mock-playback-${request.callId}-${request.segmentId}`,
      nextStep: "mock PSTN Bridge 已接收译音，真实环境需写回服务商媒体流。",
    };
  }
}

export class HttpPstnProvider implements PstnProvider {
  private readonly callRoutes = new Map<string, {
    providerCallId?: string;
    mediaStreamId?: string;
  }>();

  constructor(
    private readonly config: PstnBridgeEnv,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly mediaWriter: PstnMediaWriter = buildMediaWriter(config, fetchFn),
  ) {}

  async placeCall(request: AgentCallBridgeRequest): Promise<AgentCallBridgeResult> {
    const response = await this.fetchWithTimeout(this.callUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ...request,
        recordingDisclosureEnabled: this.config.recordingDisclosureEnabled,
      }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `PSTN upstream returned HTTP ${response.status}`);
    }
    const result = normalizeResult(body);
    this.rememberCallRoute(request.callId, result);
    return result;
  }

  async playTranslatedAudio(request: TtsAudioSinkRequest): Promise<TtsAudioSinkResult> {
    const route = this.callRoutes.get(request.callId);
    const providerCallId = request.providerCallId ?? route?.providerCallId;
    const mediaStreamId = request.mediaStreamId ?? route?.mediaStreamId;
    const telephonyAudio = toTelephonyMulaw8k(request);
    const response = await this.fetchWithTimeout(this.translatedAudioUrl(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ...request,
        providerCallId,
        mediaStreamId,
        telephonyAudio,
      }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `PSTN upstream returned HTTP ${response.status}`);
    }
    const result = normalizeAudioResult(body);
    const mediaWrite = await this.mediaWriter.write({
      callId: request.callId,
      providerCallId,
      mediaStreamId,
      segmentId: request.segmentId,
      targetSpeakerRole: request.targetSpeakerRole,
      language: request.language,
      telephonyAudio,
    });
    return { ...result, ...mediaWrite };
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.upstreamTimeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private callUrl() {
    return `${this.config.upstreamBaseUrl?.replace(/\/$/, "")}/agent-calls`;
  }

  private translatedAudioUrl() {
    return `${this.config.upstreamBaseUrl?.replace(/\/$/, "")}/translated-audio`;
  }

  private headers() {
    return {
      "content-type": "application/json",
      ...(this.config.upstreamApiKey ? { authorization: `Bearer ${this.config.upstreamApiKey}` } : {}),
    };
  }

  private rememberCallRoute(callId: string, result: AgentCallBridgeResult) {
    if (!result.providerCallId && !result.mediaStreamId) return;
    this.callRoutes.set(callId, {
      providerCallId: result.providerCallId,
      mediaStreamId: result.mediaStreamId,
    });
  }
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function normalizeResult(body: unknown): AgentCallBridgeResult {
  if (!body || typeof body !== "object") return { status: "in_progress" };
  const record = body as Record<string, unknown>;
  return {
    status: parseStatus(record.status),
    ...optional("providerCallId", record.providerCallId, 160),
    ...optional("mediaStreamId", record.mediaStreamId, 160),
    ...optional("resultSummary", record.resultSummary, 800),
    ...optional("failureReason", record.failureReason, 300),
    ...optional("nextStep", record.nextStep, 300),
  };
}

function parseStatus(value: unknown): AgentCallBridgeResult["status"] {
  return value === "completed" || value === "failed" ? value : "in_progress";
}

function normalizeAudioResult(body: unknown): TtsAudioSinkResult {
  if (!body || typeof body !== "object") return { status: "queued" };
  const record = body as Record<string, unknown>;
  return {
    status: parseAudioStatus(record.status),
    ...optional("providerPlaybackId", record.providerPlaybackId, 160),
    ...optional("mediaWriteId", record.mediaWriteId, 160),
    ...optional("failureReason", record.failureReason, 300),
    ...optional("nextStep", record.nextStep, 300),
  };
}

function parseAudioStatus(value: unknown): TtsAudioSinkResult["status"] {
  return value === "played" || value === "failed" ? value : "queued";
}

function optional(name: string, value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? { [name]: value.trim().slice(0, maxLength) }
    : {};
}
