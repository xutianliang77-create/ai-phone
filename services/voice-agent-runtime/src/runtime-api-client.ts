import { randomUUID } from "node:crypto";
import type {
  VoiceAgentRuntimeEventRequest,
  VoiceAgentRuntimeEventResponse,
  VoiceAgentRuntimeSnapshotDto,
  VoiceAgentStructuredResultDto,
  VoiceAgentToolAuthorization,
} from "@translation/contracts";
import type { VoiceAgentDispatchTicket } from "./runtime-ticket.js";

export class VoiceAgentRuntimeApiClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: {
    apiBaseUrl: string;
    internalApiSecret: string;
    timeoutMs: number;
    fetchFn?: typeof fetch;
  }) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  snapshot(input: {
    ticket: VoiceAgentDispatchTicket;
    participantIdentity: string;
    workerId: string;
    jobId: string;
  }) {
    return this.post<VoiceAgentRuntimeSnapshotDto>(
      `/internal/voice-agent/calls/${encodeURIComponent(input.ticket.callId)}/runtime-snapshot`,
      {
        ticket: input.ticket.ticket,
        participantIdentity: input.participantIdentity,
        workerId: input.workerId,
        jobId: input.jobId,
      },
    );
  }

  event(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    event: VoiceAgentRuntimeEventRequest["event"];
    eventId?: string;
    workerId?: string;
    jobId?: string;
    errorClass?: string;
    amdCategory?: VoiceAgentRuntimeEventRequest["amdCategory"];
    transcriptSummary?: string;
    result?: VoiceAgentStructuredResultDto;
  }) {
    return this.post<VoiceAgentRuntimeEventResponse>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/runtime-events`,
      {
        ticket: input.ticket.ticket,
        eventId: input.eventId ?? randomUUID(),
        event: input.event,
        ...(input.workerId ? { workerId: input.workerId } : {}),
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(input.errorClass ? { errorClass: input.errorClass } : {}),
        ...(input.amdCategory ? { amdCategory: input.amdCategory } : {}),
        ...(input.transcriptSummary
          ? { transcriptSummary: input.transcriptSummary }
          : {}),
        ...(input.result ? { result: input.result } : {}),
      },
    );
  }

  authorizeTool(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    toolName: "send_dtmf" | "request_takeover";
    toolCallId: string;
    idempotencyKey: string;
    arguments: Record<string, unknown>;
  }) {
    return this.post<VoiceAgentToolAuthorization & { replayed?: boolean }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/tools/${input.toolName}/authorize`,
      {
        ticket: input.ticket.ticket,
        toolCallId: input.toolCallId,
        idempotencyKey: input.idempotencyKey,
        arguments: input.arguments,
      },
    );
  }

  completeTool(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    executionId: string;
    status: "succeeded" | "failed" | "cancelled";
    resultSummary?: string;
  }) {
    return this.post(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/tools/${encodeURIComponent(input.executionId)}/complete`,
      {
        ticket: input.ticket.ticket,
        status: input.status,
        ...(input.resultSummary ? { resultSummary: input.resultSummary } : {}),
      },
    );
  }

  hangup(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    reason: "task_finished" | "task_cancelled" | "runtime_failed";
  }) {
    return this.post<{ status: string; replayed: boolean }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/tools/hangup_call/execute`,
      { ticket: input.ticket.ticket, reason: input.reason },
    );
  }

  private async post<T = unknown>(path: string, body: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchFn(`${this.options.apiBaseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.internalApiSecret}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Voice Agent API returned HTTP ${response.status}`);
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
