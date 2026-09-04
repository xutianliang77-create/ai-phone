import { randomUUID } from "node:crypto";
import type {
  AgentDeliveryCommand,
  AgentDeliveryLifecycleEvent,
  AgentVoiceTurnScopeDto,
  AgentWorkDto,
  AgentWorkCancelPayload,
  VoiceAgentRuntimeEventRequest,
  VoiceAgentRuntimeEventResponse,
  VoiceAgentRecordingConsentEvent,
  VoiceAgentRuntimeSnapshotDto,
  VoiceAgentStructuredResultDto,
  VoiceAgentToolAuthorization,
  VoiceAgentPermissionRequestDto,
  VoiceAgentTurnEventResponse,
} from "@translation/contracts";
import type { VoiceAgentDispatchTicket } from "./runtime-ticket.js";
import { postVoiceAgentRuntimeApi } from "./runtime-api-http.js";

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
    recordingConsent?: VoiceAgentRecordingConsentEvent;
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
        ...(input.recordingConsent
          ? { recordingConsent: input.recordingConsent }
          : {}),
        ...(input.result ? { result: input.result } : {}),
      },
    );
  }

  observeTurn(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    eventId?: string;
    eventType: "user_speaking" | "final_transcript" | "session_ending";
    observedAt: string;
    explicitInstructionEvidenceHash?: string;
  }) {
    return this.post<VoiceAgentTurnEventResponse>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/voice-turn-events`,
      {
        ticket: input.ticket.ticket,
        eventId: input.eventId ?? randomUUID(),
        eventType: input.eventType,
        observedAt: input.observedAt,
        ...(input.explicitInstructionEvidenceHash
          ? { explicitInstructionEvidenceHash:
              input.explicitInstructionEvidenceHash }
          : {}),
      },
    );
  }

  requestWorkPermission(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    permissionRequestId: string;
    commandId: string;
    turn: AgentVoiceTurnScopeDto;
    toolName: string;
    toolVersion: string;
    submissionKey: string;
    arguments: Record<string, unknown>;
    argumentsHash: string;
    reasonCode: string;
    expiresAt: string;
  }) {
    return this.post<{
      replayed: boolean;
      permission: VoiceAgentPermissionRequestDto;
    }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/agent-work/permissions`,
      {
        ticket: input.ticket.ticket,
        permissionRequestId: input.permissionRequestId,
        commandId: input.commandId,
        turnId: input.turn.turnId,
        turnGeneration: input.turn.turnGeneration,
        dispatchGeneration: input.turn.dispatchGeneration,
        explicitInstructionEvidenceHash:
          input.turn.explicitInstructionEvidenceHash,
        toolName: input.toolName,
        toolVersion: input.toolVersion,
        submissionKey: input.submissionKey,
        arguments: input.arguments,
        argumentsHash: input.argumentsHash,
        reasonCode: input.reasonCode,
        expiresAt: input.expiresAt,
      },
    );
  }

  workPermissionStatus(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    permissionRequestId: string;
  }) {
    return this.post<{ permission: VoiceAgentPermissionRequestDto }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/agent-work/permissions/${
        encodeURIComponent(input.permissionRequestId)
      }/status`,
      { ticket: input.ticket.ticket },
    );
  }

  createWork(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    workId: string;
    commandId: string;
    turnId: string;
    permissionRequestId: string;
    authorizationSnapshotId: string;
  }) {
    return this.post<{ replayed: boolean; work: AgentWorkDto }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/agent-work`,
      {
        ticket: input.ticket.ticket,
        workId: input.workId,
        commandId: input.commandId,
        turnId: input.turnId,
        permissionRequestId: input.permissionRequestId,
        authorizationSnapshotId: input.authorizationSnapshotId,
      },
    );
  }

  workStatus(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    workId: string;
  }) {
    return this.post<{ work: AgentWorkDto }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/agent-work/${encodeURIComponent(input.workId)}/status`,
      { ticket: input.ticket.ticket },
    );
  }

  cancelWork(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    workId: string;
    commandId: string;
    payload: AgentWorkCancelPayload;
  }) {
    return this.post<{ replayed: boolean; work: AgentWorkDto }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/agent-work/${encodeURIComponent(input.workId)}/cancel`,
      {
        ticket: input.ticket.ticket,
        commandId: input.commandId,
        payload: input.payload,
      },
    );
  }

  authorizeDelivery(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    command: AgentDeliveryCommand;
  }) {
    return this.post<{
      authorized: true;
      expiresAt: string;
      playbackGeneration: number;
    }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/agent-deliveries/${
        encodeURIComponent(input.command.deliveryAttemptId)
      }/authorize`,
      { ticket: input.ticket.ticket, command: input.command },
    );
  }

  deliveryLifecycle(input: {
    snapshot: VoiceAgentRuntimeSnapshotDto;
    ticket: VoiceAgentDispatchTicket;
    event: AgentDeliveryLifecycleEvent;
  }) {
    return this.post<{
      replayed: boolean;
      status: string;
      serverPlaybackState: string;
      clientLifecycleQueued: true;
    }>(
      `/internal/ai-calling-agent/drafts/${
        encodeURIComponent(input.snapshot.draftId)
      }/agent-deliveries/${
        encodeURIComponent(input.event.deliveryAttemptId)
      }/lifecycle`,
      { ticket: input.ticket.ticket, event: input.event },
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
    return postVoiceAgentRuntimeApi<T>({
      ...this.options,
      fetchFn: this.fetchFn,
      path,
      body,
    });
  }
}
