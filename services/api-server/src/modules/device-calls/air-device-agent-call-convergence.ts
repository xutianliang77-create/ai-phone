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
