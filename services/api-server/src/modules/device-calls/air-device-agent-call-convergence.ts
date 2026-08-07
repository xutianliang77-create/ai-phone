import type {
  AirDeviceCallDto,
  AirDeviceCarrierEventRequest,
  PstnAgentCallWebhookRequest,
} from "@translation/contracts";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { updateAgentCallFromPstnWebhook } from
  "../agent-calls/agent-call-webhook-runtime.js";
import { getVoiceAgentRuntimeSupervisor } from
  "../agent-calls/voice-agent-runtime-supervisor.js";
import {
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import { endCallLegs } from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import {
  deliverPendingCallRoomDataEvents,
} from "../call-links/call-room-worker.js";
import {
  findCallLink,
  type CallLinkRecord,
} from "../call-links/call-links.service.js";
import { getCallLinkWorkerSupervisor } from
  "../call-links/call-link-worker-supervisor.js";

export function airCarrierAgentStatusRequest(
  event: AirDeviceCarrierEventRequest,
  call: AirDeviceCallDto,
): PstnAgentCallWebhookRequest | null {
  const base = {
    eventId: `air-carrier:${event.eventId}`,
    callId: event.communicationSessionId,
    providerCallId: event.providerCallId,
  };
  if (event.carrierState === "connected") {
    return {
      ...base,
      status: "in_progress",
      providerOperationStatus: "accepted",
    };
  }
  if (!terminalCarrierState(event.carrierState)) return null;
  if (event.carrierState === "disconnected" && call.connectedAt) {
    return {
      ...base,
      status: "completed",
      providerOperationStatus: "succeeded",
      consumedSeconds: connectedSeconds(call, event.occurredAt),
    };
  }
  return {
    ...base,
    status: "failed",
    providerOperationStatus: "failed",
    failureReason: `carrier_${event.carrierCause}`,
    nextStep: "核对运营商线路状态和号码后，由用户决定是否重新发起。",
  };
}

export async function convergeAirDeviceAgentCall(
  event: AirDeviceCarrierEventRequest,
  call: AirDeviceCallDto,
) {
  const request = airCarrierAgentStatusRequest(event, call);
  try {
    if (!request) return null;
    const result = await updateAgentCallFromPstnWebhook(request);
    if (terminalCarrierState(event.carrierState) &&
      "draft" in result && result.draft.callId) {
      await getVoiceAgentRuntimeSupervisor().stop(result.draft.callId);
    }
    return result;
  } finally {
    if (terminalCarrierState(event.carrierState)) {
      await releaseCallLease(call);
    }
  }
}

/**
 * Converges both Air780 call-link translation calls and voice-agent calls.
 * Carrier state is authoritative; a LiveKit participant event alone never
 * completes a human translation session.
 */
export async function convergeAirDeviceCall(
  event: AirDeviceCarrierEventRequest,
  call: AirDeviceCallDto,
) {
  const record = await findCallLink(event.communicationSessionId);
  if (!record || record.purpose !== "human_call") {
    return convergeAirDeviceAgentCall(event, call);
  }
  return convergeAirDeviceCallLink(record, event, call);
}

async function convergeAirDeviceCallLink(
  record: CallLinkRecord,
  event: AirDeviceCarrierEventRequest,
  call: AirDeviceCallDto,
) {
  try {
    const operation = await findProviderOperation(call.providerOperationId);
    if (!operation || operation.provider !== "air780_volte" ||
      operation.operationType !== "phone_outbound" ||
      operation.sessionId !== event.communicationSessionId) {
      return null;
    }
    if (event.carrierState === "connected") {
      if (["active", "succeeded", "failed", "cancelled"].includes(operation.status)) {
        return operation;
      }
      const updated = await updateProviderOperation({
        operationId: operation.id,
        status: "active",
        expectedVersion: operation.version,
        externalResourceId: event.providerCallId,
        now: new Date(event.occurredAt),
      });
      return "operation" in updated ? updated.operation : operation;
    }
    if (!terminalCarrierState(event.carrierState)) return operation;

    return await withSessionWriteLock(record.callId, async () => {
      const current = await findProviderOperation(operation.id) ?? operation;
      if (["succeeded", "failed", "cancelled"].includes(current.status)) {
        return current;
      }
      const endedAt = call.endedAt ?? event.occurredAt;
      const terminalStatus = event.carrierState === "disconnected" && call.connectedAt
        ? "succeeded" as const
        : "failed" as const;
      const billableSeconds = terminalStatus === "succeeded"
        ? connectedSeconds(call, endedAt)
        : 0;
      const session = await completeSessionWithUsage(
        event.communicationSessionId,
        { billableSeconds },
      );
      if (session?.endedAt) await endCallLegs(session.id, session.endedAt);
      const updated = await updateProviderOperation({
        operationId: current.id,
        status: terminalStatus,
        expectedVersion: current.version,
        externalResourceId: event.providerCallId,
        errorClass: terminalStatus === "failed"
          ? `carrier_${event.carrierCause}`
          : undefined,
        completionObservedAt: endedAt,
        completionObservedEvent: `carrier_${event.carrierState}`,
        now: new Date(endedAt),
      });
      const terminal = "operation" in updated ? updated.operation : current;
      await deliverPendingCallRoomDataEvents(record).catch(() => undefined);
      await getCallLinkWorkerSupervisor().stop(record.callId);
      return terminal;
    });
  } finally {
    if (terminalCarrierState(event.carrierState)) {
      await releaseCallLease(call);
    }
  }
}

function terminalCarrierState(state: AirDeviceCarrierEventRequest["carrierState"]) {
  return state === "disconnected" || state === "busy" || state === "failed";
}

function connectedSeconds(call: AirDeviceCallDto, occurredAt: string) {
  const start = Date.parse(call.connectedAt ?? "");
  const end = Date.parse(call.endedAt ?? occurredAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.ceil((end - start) / 1_000);
}

async function releaseCallLease(call: AirDeviceCallDto) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return;
  await runtime.postgres.airDeviceRegistry.release({
    deviceId: call.deviceId,
    leaseId: call.leaseId,
    fencingToken: call.fencingToken,
    heartbeatFreshnessSeconds: boundedInteger(
      process.env.AIR_DEVICE_HEARTBEAT_FRESHNESS_SECONDS,
      30,
      5,
      300,
    ),
  });
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
