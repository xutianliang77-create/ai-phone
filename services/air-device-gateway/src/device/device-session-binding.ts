import type {
  AirDeviceCarrierCause,
  AirDeviceCarrierState,
  AirDeviceSessionBinding,
  SessionBoundAudioChunk,
  SessionBoundCarrierState,
} from "./device-session-router.js";

export function sameAirDeviceBinding(
  decoded: AirDeviceSessionBinding,
  active: AirDeviceSessionBinding,
) {
  return decoded.communicationSessionId === active.communicationSessionId &&
    decoded.providerCallId === active.providerCallId &&
    decoded.deviceId === active.deviceId && decoded.leaseId === active.leaseId &&
    decoded.fencingToken === active.fencingToken &&
    decoded.callGeneration === active.callGeneration;
}

export function assertAirDeviceBinding(input: AirDeviceSessionBinding) {
  if (!hasBinding(input) || !Number.isSafeInteger(input.fencingToken) ||
    input.fencingToken < 1 || !isUint32(input.callGeneration)) {
    throw new Error("Invalid Air device session binding");
  }
}

export function assertAirDeviceLeaseProgress(
  input: AirDeviceSessionBinding,
  previous: AirDeviceSessionBinding,
) {
  if (input.deviceId !== previous.deviceId) {
    throw new Error("deviceId cannot change on a session router");
  }
  if (input.leaseId === previous.leaseId) {
    if (input.communicationSessionId !== previous.communicationSessionId) {
      throw new Error("leaseId cannot move to another communication session");
    }
    if (input.fencingToken < previous.fencingToken) {
      throw new Error("fencingToken cannot decrease");
    }
    return;
  }
  if (input.fencingToken <= previous.fencingToken) {
    throw new Error("fencingToken must increase for a new lease");
  }
}

export function isSessionBoundAudioChunk(
  value: unknown,
): value is SessionBoundAudioChunk {
  const input = value as Partial<SessionBoundAudioChunk> | null;
  return Boolean(input && hasBinding(input) &&
    Number.isSafeInteger(input.fencingToken) && input.fencingToken! >= 1 &&
    isUint32(input.callGeneration) && isUint32(input.deviceSequence) &&
    input.payload instanceof Uint8Array);
}

export function isSessionBoundCarrierState(
  value: unknown,
): value is SessionBoundCarrierState {
  const input = value as Partial<SessionBoundCarrierState> | null;
  return Boolean(input && hasBinding(input) &&
    Number.isSafeInteger(input.fencingToken) && input.fencingToken! >= 1 &&
    isUint32(input.callGeneration) && isUint32(input.eventSequence) &&
    typeof input.deviceTimestampMs === "bigint" && input.deviceTimestampMs >= 0n &&
    validCarrierStateCause(input.carrierState, input.carrierCause));
}

export function isTerminalCarrierState(state: AirDeviceCarrierState) {
  return state === "disconnected" || state === "busy" || state === "failed";
}

function hasBinding(input: Partial<AirDeviceSessionBinding>) {
  return [input.communicationSessionId, input.providerCallId, input.deviceId,
    input.leaseId].every((value) =>
      typeof value === "string" && value.trim().length > 0);
}

function validCarrierStateCause(
  state: AirDeviceCarrierState | undefined,
  cause: AirDeviceCarrierCause | undefined,
) {
  if (!state || !cause) return false;
  const allowed: Record<AirDeviceCarrierState, AirDeviceCarrierCause[]> = {
    dialing: ["none"],
    ringing: ["none"],
    connected: ["none"],
    disconnected: ["local_hangup", "remote_hangup", "no_answer", "rejected",
      "unknown"],
    busy: ["busy"],
    failed: ["network_error", "device_error", "unknown"],
    unknown: ["unknown"],
  };
  return allowed[state]?.includes(cause) ?? false;
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 &&
    Number(value) <= 0xffffffff;
}
