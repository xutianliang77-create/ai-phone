import { z } from "zod";
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

  private async post<T = unknown>(callId: string, route: string, body: unknown) {
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
