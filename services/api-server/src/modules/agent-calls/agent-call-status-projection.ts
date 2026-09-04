import type {
  AiCallingAgentDraftDto,
  AirDeviceCallDto,
} from "@translation/contracts";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { findCallLink } from "../call-links/call-links.service.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import { toAgentCallDto } from "./agent-call-route-helpers.js";

export type AgentCallTelephonyStatusReader = (
  record: AgentCallRecord,
) => Promise<AirDeviceCallDto | null>;

export async function toAgentCallReadDto(
  record: AgentCallRecord,
  readStatus: AgentCallTelephonyStatusReader = readAirDeviceCallStatus,
): Promise<AiCallingAgentDraftDto> {
  const draft = toAgentCallDto(record);
  if (record.executionProvider !== "air780_volte" ||
    !record.callId || !record.providerOperationId) return draft;
  const call = await readStatus(record);
  if (!call) return draft;
  return {
    ...draft,
    carrierState: call.carrierState,
    liveKitParticipantState: call.liveKitParticipantState,
    deviceId: call.deviceId,
    callGeneration: call.callGeneration,
  };
}

async function readAirDeviceCallStatus(record: AgentCallRecord) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres" || !record.callId ||
    !record.providerOperationId) return null;
  const call = await findCallLink(record.callId);
  if (!call) return null;
  return runtime.postgres.airDeviceCalls.findCallStatus({
    communicationSessionId: call.sessionId,
    providerOperationId: record.providerOperationId,
  });
}
