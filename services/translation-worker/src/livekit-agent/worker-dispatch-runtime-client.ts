import { z } from "zod";
import type {
  CallLinkPublicTtsAttemptAck,
  CallLinkPublicTtsAttemptEvent,
  CallLinkPublicTtsMaterial,
  CallLinkPublicTtsProfile,
} from "@translation/contracts";
import type { TtsVoiceConfig } from "../worker/types.js";

const ticketPayloadSchema = z.object({
  v: z.literal(1),
  callId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  roomName: z.string().min(1).max(256),
  agentName: z.string().min(1).max(64),
  generation: z.number().int().positive(),
  nonce: z.string().min(1).max(64),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
}).strict();

export type ParsedWorkerDispatchTicket = z.infer<typeof ticketPayloadSchema> & {
  ticket: string;
};

export interface WorkerRuntimeSnapshot {
  callId: string;
  sessionId: string;
  roomName: string;
  generation: number;
  participantIdentity: string;
  ttsVoice?: TtsVoiceConfig;
  translationControl?: {
    sourceLanguage: "zh" | "en";
    targetLanguage: "zh" | "en";
    uplinkPaused: boolean;
    controlGeneration: number;
  };
  publicTts?: CallLinkPublicTtsProfile;
}

export function parseWorkerDispatchMetadata(value: string) {
  if (Buffer.byteLength(value) > 4096) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    const payload = ticketPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    return payload.success ? { ...payload.data, ticket: value } : null;
  } catch {
    return null;
  }
}

export class WorkerDispatchRuntimeClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret?: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async snapshot(input: {
    ticket: ParsedWorkerDispatchTicket;
    participantIdentity: string;
    workerId: string;
    jobId: string;
  }) {
    return await this.post<WorkerRuntimeSnapshot>(
      input.ticket.callId,
      "worker-snapshot",
      {
        ticket: input.ticket.ticket,
        participantIdentity: input.participantIdentity,
        workerId: input.workerId,
        jobId: input.jobId,
      },
    );
  }

  async event(input: {
    ticket: ParsedWorkerDispatchTicket;
    event: "ready" | "heartbeat" | "failed" | "ending";
    workerId: string;
    jobId: string;
    errorClass?: string;
  }) {
    return await this.post(
      input.ticket.callId,
      "worker-runtime",
      {
        ticket: input.ticket.ticket,
        event: input.event,
        workerId: input.workerId,
        jobId: input.jobId,
        ...(input.errorClass ? { errorClass: input.errorClass.slice(0, 80) } : {}),
      },
    );
  }

  async ttsMaterial(input: {
    ticket: ParsedWorkerDispatchTicket;
    participantIdentity: string;
    workerId: string;
    jobId: string;
    credentialAccessSecret: string;
  }): Promise<CallLinkPublicTtsMaterial> {
    const secret = validatedCredentialAccessSecret(input.credentialAccessSecret);
    const value = await this.post<unknown>(
      input.ticket.callId,
      "worker-tts-material",
      {
        ticket: input.ticket.ticket,
        participantIdentity: input.participantIdentity,
        workerId: input.workerId,
        jobId: input.jobId,
      },
      { "x-wujie-worker-tts-credential": secret },
    );
    return parseTtsMaterial(value, input);
  }

  async recordTtsAttempt(input: {
    ticket: ParsedWorkerDispatchTicket;
    participantIdentity: string;
    workerId: string;
    jobId: string;
    credentialAccessSecret: string;
    event: CallLinkPublicTtsAttemptEvent;
  }): Promise<CallLinkPublicTtsAttemptAck> {
    const secret = validatedCredentialAccessSecret(input.credentialAccessSecret);
    const value = await this.post<unknown>(
      input.ticket.callId,
      "worker-tts-attempt",
      {
        ticket: input.ticket.ticket,
        participantIdentity: input.participantIdentity,
        workerId: input.workerId,
        jobId: input.jobId,
        event: structuredClone(input.event),
      },
      { "x-wujie-worker-tts-credential": secret },
    );
    if (!isRecord(value) || Object.keys(value).length !== 3 ||
      value.costStatus !== "unknown" || !validTimestamp(value.recordedAt) ||
      !sameJson(value.event, input.event)) {
      throw new Error("Worker TTS attempt acknowledgement is invalid");
    }
    return value as CallLinkPublicTtsAttemptAck;
  }

  private async post<T = unknown>(
    callId: string,
    route: string,
    body: unknown,
    additionalHeaders: Record<string, string> = {},
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.options.apiBaseUrl.replace(/\/$/, "")}/internal/call-links/${
          encodeURIComponent(callId)
        }/${route}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...additionalHeaders,
            ...(this.options.internalApiSecret
              ? { authorization: `Bearer ${this.options.internalApiSecret}` }
              : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Worker runtime API returned HTTP ${response.status}`);
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseTtsMaterial(
  value: unknown,
  input: {
    ticket: ParsedWorkerDispatchTicket;
    participantIdentity: string;
    workerId: string;
    jobId: string;
  },
): CallLinkPublicTtsMaterial {
  if (!isRecord(value) || Object.keys(value).length !== 7 ||
    value.callId !== input.ticket.callId || value.sessionId !== input.ticket.sessionId ||
    value.generation !== input.ticket.generation || value.workerId !== input.workerId ||
    value.jobId !== input.jobId || !validTtsProfile(value.profile) ||
    !isRecord(value.credentials) || Object.keys(value.credentials).length !== 2 ||
    !validSecret(value.credentials.secretId) || !validSecret(value.credentials.secretKey)) {
    throw new Error("Worker TTS material binding is invalid");
  }
  return {
    callId: value.callId,
    sessionId: value.sessionId,
    generation: value.generation,
    workerId: value.workerId,
    jobId: value.jobId,
    profile: structuredClone(value.profile) as CallLinkPublicTtsProfile,
    credentials: {
      secretId: value.credentials.secretId,
      secretKey: value.credentials.secretKey,
    },
  };
}

function validTtsProfile(value: unknown): value is CallLinkPublicTtsProfile {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    "providerId", "protocol", "endpoint", "modelId", "appId", "voice",
    "volume", "timeoutMs", "sampleRate",
  ].includes(key)) || value.providerId !== "tencent" ||
    value.protocol !== "tencent_tts_ws" || !validIdentifier(value.modelId) ||
    !validIdentifier(value.appId) || !validIdentifier(value.voice) ||
    !validWssEndpoint(value.endpoint) || !Number.isFinite(value.volume) ||
    Number(value.volume) < -10 || Number(value.volume) > 10 ||
    !Number.isInteger(value.timeoutMs) || Number(value.timeoutMs) < 250 ||
    Number(value.timeoutMs) > 120000 ||
    (value.sampleRate !== 16000 && value.sampleRate !== 24000)) {
    return false;
  }
  return true;
}

function validatedCredentialAccessSecret(value: string) {
  if (!validSecret(value) || value.length < 32) {
    throw new Error("Worker TTS credential access is invalid");
  }
  return value;
}

function validSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validIdentifier(value: unknown): value is string {
  return validSecret(value) && value.length <= 240;
}

function validWssEndpoint(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === "wss:" && url.pathname === "/stream_wsv2" &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown) {
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
