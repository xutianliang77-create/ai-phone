import { toTelephonyMulaw8k } from "./audio-codec.js";
import { buildMediaWriter } from "./media-writer.js";
import type {
  AgentCallBridgeRequest,
  AgentCallBridgeResult,
  PstnBridgeEnv,
  PstnMediaWriter,
  PstnProvider,
  TtsAudioSinkRequest,
  TtsAudioSinkResult,
} from "./types.js";

export class FonosterPstnProvider implements PstnProvider {
  readonly playbackCapabilities = {
    bidirectionalMedia: false,
    streamingWrite: false,
    clearPlayback: false,
  } as const;
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
      headers: {
        ...this.headers(),
        "idempotency-key": request.idempotencyKey,
      },
      body: JSON.stringify(this.callBody(request)),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `Fonoster facade returned HTTP ${response.status}`);
    }
    const result = normalizeCallResult(body);
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
        provider: "fonoster",
        idempotencyKey:
          `tts:${request.callId}:${request.playbackId}:${request.generation}`,
        ...request,
        providerCallId,
        mediaStreamId,
        telephonyAudio,
      }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `Fonoster facade returned HTTP ${response.status}`);
    }
    const result = normalizeAudioResult(body);
    const mediaWrite = await this.mediaWriter.write({
      callId: request.callId,
      sessionId: request.sessionId,
      providerCallId,
      mediaStreamId,
      segmentId: request.segmentId,
      playbackId: request.playbackId,
      generation: request.generation,
      targetLegId: request.targetLegId,
      targetSpeakerRole: request.targetSpeakerRole,
      language: request.language,
      telephonyAudio,
    });
    return { ...result, ...mediaWrite };
  }

  private callBody(request: AgentCallBridgeRequest) {
    return {
      from: requiredConfig("PSTN_BRIDGE_FONOSTER_FROM_NUMBER", this.config.fonosterFromNumber),
      to: request.targetPhone,
      appRef: requiredConfig("PSTN_BRIDGE_FONOSTER_APP_REF", this.config.fonosterAppRef),
      timeout: this.config.fonosterCallTimeoutSeconds ?? 60,
      metadata: {
        provider: "fonoster",
        draftId: limit(request.draftId, 160),
        callId: limit(request.callId, 160),
        targetName: limit(request.targetName, 120),
        objective: limit(request.objective, 500),
        suggestedScript: limit(request.suggestedScript, 800),
        language: limit(request.language, 40),
        consentPromptVersion: limit(request.consentPromptVersion, 80),
        recordingDisclosureEnabled: String(this.config.recordingDisclosureEnabled),
      },
    };
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
    return `${this.baseUrl()}/calls`;
  }

  private translatedAudioUrl() {
    return `${this.baseUrl()}/translated-audio`;
  }

  private baseUrl() {
    return requiredConfig("PSTN_BRIDGE_FONOSTER_BASE_URL", this.config.fonosterBaseUrl)
      .replace(/\/$/, "");
  }

  private headers() {
    return {
      "content-type": "application/json",
      "x-fonoster-access-key-id": requiredConfig(
        "PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID",
        this.config.fonosterAccessKeyId,
      ),
      "x-fonoster-api-key": requiredConfig("PSTN_BRIDGE_FONOSTER_API_KEY", this.config.fonosterApiKey),
      "x-fonoster-api-secret": requiredConfig(
        "PSTN_BRIDGE_FONOSTER_API_SECRET",
        this.config.fonosterApiSecret,
      ),
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

function normalizeCallResult(body: unknown): AgentCallBridgeResult {
  if (!body || typeof body !== "object") return { status: "in_progress" };
  const record = body as Record<string, unknown>;
  return {
    status: parseStatus(record.status),
    ...optional("providerCallId", record.providerCallId ?? record.ref, 160),
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

function limit(value: string | undefined, maxLength: number) {
  return (value ?? "").trim().slice(0, maxLength);
}

function requiredConfig(name: string, value: string | undefined) {
  if (value?.trim()) return value.trim();
  throw new Error(`PSTN Bridge missing ${name}`);
}
