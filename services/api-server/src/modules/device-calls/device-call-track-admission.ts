import type { AirDeviceTrackAdmissionDto } from "@translation/contracts";

interface LeaseVerifier {
  assertLease(input: {
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    nowMs: number;
  }): Promise<void> | void;
}

interface CallBindingVerifier {
  assertCallBinding(input: {
    communicationSessionId: string;
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    callGeneration: number;
  }): Promise<void> | void;
}

export async function createAirDeviceTrackAdmission(input: {
  communicationSessionId: string;
  roomName: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  callGeneration: number;
  targetParticipantIdentity: string;
  trackSid: string;
  trackName: string;
  publisherIdentity: string;
}, dependencies: {
  leaseVerifier: LeaseVerifier;
  callVerifier: CallBindingVerifier;
  nowMs: number;
}): Promise<AirDeviceTrackAdmissionDto> {
  const validation = airDeviceTrackAdmissionValidationReason(input);
  if (validation !== "ok" || !Number.isFinite(dependencies.nowMs)) {
    const error = new Error("Invalid Air device track admission");
    Object.assign(error, {
      code: validation !== "ok" ? validation : "clock",
    });
    throw error;
  }
  await dependencies.leaseVerifier.assertLease({
    deviceId: input.deviceId,
    leaseId: input.leaseId,
    fencingToken: input.fencingToken,
    nowMs: dependencies.nowMs,
  });
  await dependencies.callVerifier.assertCallBinding({
    communicationSessionId: input.communicationSessionId,
    deviceId: input.deviceId,
    leaseId: input.leaseId,
    fencingToken: input.fencingToken,
    callGeneration: input.callGeneration,
  });
  return {
    trackSid: input.trackSid,
    trackName: input.trackName,
    publisherIdentity: input.publisherIdentity,
    communicationSessionId: input.communicationSessionId,
    targetParticipantIdentity: input.targetParticipantIdentity,
    deviceId: input.deviceId,
    leaseId: input.leaseId,
    callGeneration: input.callGeneration,
  };
}

export function airDeviceTrackAdmissionValidationReason(input: {
  communicationSessionId: string;
  roomName: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  callGeneration: number;
  targetParticipantIdentity: string;
  trackSid: string;
  trackName: string;
  publisherIdentity: string;
}): "ok" | "communication_session_id" | "device_id" |
  "lease_id" | "track_sid" | "fencing_token" | "call_generation" |
  "room_name" | "target_identity" | "publisher_identity" | "track_name" {
  const identifier = /^[A-Za-z0-9_-]+$/;
  if (!identifier.test(input.communicationSessionId) ||
    input.communicationSessionId.length > 160) return "communication_session_id";
  if (!identifier.test(input.deviceId) || input.deviceId.length > 128) return "device_id";
  if (!identifier.test(input.leaseId) || input.leaseId.length > 128) return "lease_id";
  if (!identifier.test(input.trackSid) || input.trackSid.length > 160) return "track_sid";
  if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1) return "fencing_token";
  if (!Number.isInteger(input.callGeneration) || input.callGeneration < 0 ||
    input.callGeneration > 0xffffffff) return "call_generation";
  const targetIdentity =
    `${input.communicationSessionId}:guest:air:${input.deviceId}`;
  const workerPrefix = `${input.communicationSessionId}:worker:`;
  const workerSuffix = input.publisherIdentity.slice(workerPrefix.length);
  const targetToken = Buffer.from(targetIdentity).toString("base64url");
  if (input.roomName !== `call_${input.communicationSessionId}`) return "room_name";
  if (input.targetParticipantIdentity !== targetIdentity) return "target_identity";
  if (!input.publisherIdentity.startsWith(workerPrefix) ||
    !identifier.test(workerSuffix) || workerSuffix.length > 128) {
    return "publisher_identity";
  }
  if (!new RegExp(`^translation-tts-guest-[1-9][0-9]*\\.${targetToken}$`)
    .test(input.trackName)) return "track_name";
  return "ok";
}
