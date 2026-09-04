import type { QueryResultRow } from "pg";
import type {
  AirDeviceCallDto,
  AirDeviceMediaPolicy,
} from "@translation/contracts";

export interface AirDeviceCallRecordInput {
  providerCallId: string;
  providerOperationId: string;
  communicationSessionId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  roomName: string;
  participantIdentity: string;
  callGeneration: number;
  mediaPolicy: AirDeviceMediaPolicy;
}

export interface AirDeviceCallRow extends QueryResultRow {
  provider_call_id: string;
  communication_session_id: string;
  provider_operation_id: string;
  device_id: string;
  lease_id: string;
  fencing_token: string;
  carrier_state: AirDeviceCallDto["carrierState"];
  livekit_participant_state: AirDeviceCallDto["liveKitParticipantState"];
  call_generation: string;
  media_policy: AirDeviceMediaPolicy;
  version: string;
  room_name: string;
  participant_identity: string;
  carrier_event_sequence: string;
  livekit_event_sequence: string;
  connected_at?: Date | string | null;
  ended_at?: Date | string | null;
}

export function matchesAirDeviceDial(
  row: AirDeviceCallRow,
  input: AirDeviceCallRecordInput,
) {
  return row.provider_call_id === input.providerCallId &&
    row.provider_operation_id === input.providerOperationId &&
    row.communication_session_id === input.communicationSessionId &&
    row.device_id === input.deviceId && row.lease_id === input.leaseId &&
    Number(row.fencing_token) === input.fencingToken &&
    row.room_name === input.roomName &&
    row.participant_identity === input.participantIdentity &&
    Number(row.call_generation) === input.callGeneration &&
    row.media_policy === input.mediaPolicy;
}

export function airDeviceCallFromRow(row: AirDeviceCallRow): AirDeviceCallDto {
  const fencingToken = Number(row.fencing_token);
  const callGeneration = Number(row.call_generation);
  const version = Number(row.version);
  if (!row.provider_call_id || !row.communication_session_id ||
    !row.provider_operation_id || !row.device_id || !row.lease_id ||
    !Number.isSafeInteger(fencingToken) || fencingToken < 1 ||
    !Number.isSafeInteger(callGeneration) || callGeneration < 0 ||
    !isAirDeviceMediaPolicy(row.media_policy) ||
    !Number.isSafeInteger(version) || version < 1) {
    throw new Error("Invalid PostgreSQL Air device call");
  }
  const connectedAt = timestamp(row.connected_at);
  const endedAt = timestamp(row.ended_at);
  return {
    providerCallId: row.provider_call_id,
    communicationSessionId: row.communication_session_id,
    providerOperationId: row.provider_operation_id,
    deviceId: row.device_id,
    leaseId: row.lease_id,
    fencingToken,
    carrierState: row.carrier_state,
    liveKitParticipantState: row.livekit_participant_state,
    callGeneration,
    mediaPolicy: row.media_policy,
    version,
    ...(connectedAt ? { connectedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
  };
}

export function airDeviceControlBindingFromRow(row: AirDeviceCallRow) {
  const call = airDeviceCallFromRow(row);
  if (!row.room_name || !row.participant_identity) {
    throw new Error("Invalid PostgreSQL Air device control binding");
  }
  return {
    providerCallId: call.providerCallId,
    participantIdentity: row.participant_identity,
    roomName: row.room_name,
    carrierState: call.carrierState,
    callGeneration: call.callGeneration,
    deviceLease: {
      deviceId: call.deviceId,
      leaseId: call.leaseId,
      fencingToken: call.fencingToken,
    },
  };
}

function isAirDeviceMediaPolicy(value: unknown): value is AirDeviceMediaPolicy {
  return value === "translation_isolated" || value === "agent_monitored";
}

function timestamp(value: Date | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
