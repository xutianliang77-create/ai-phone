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
  if (!validBinding(input) || !Number.isFinite(dependencies.nowMs)) {
    throw new Error("Invalid Air device track admission");
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

function validBinding(input: {
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
}) {
  const identifier = /^[A-Za-z0-9_-]+$/;
  if (!identifier.test(input.communicationSessionId) ||
    input.communicationSessionId.length > 160 ||
    !identifier.test(input.deviceId) || input.deviceId.length > 128 ||
    !identifier.test(input.leaseId) || input.leaseId.length > 128 ||
    !identifier.test(input.trackSid) || input.trackSid.length > 160 ||
    !Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1 ||
    !Number.isInteger(input.callGeneration) || input.callGeneration < 0 ||
    input.callGeneration > 0xffffffff) return false;
  const targetIdentity =
    `${input.communicationSessionId}:guest:air:${input.deviceId}`;
  const workerPrefix = `${input.communicationSessionId}:worker:`;
  const workerSuffix = input.publisherIdentity.slice(workerPrefix.length);
  const targetToken = Buffer.from(targetIdentity).toString("base64url");
  return input.roomName === `call_${input.communicationSessionId}` &&
    input.targetParticipantIdentity === targetIdentity &&
    input.publisherIdentity.startsWith(workerPrefix) &&
    identifier.test(workerSuffix) && workerSuffix.length <= 128 &&
    new RegExp(`^translation-tts-guest-[1-9][0-9]*\\.${targetToken}$`)
      .test(input.trackName);
}
