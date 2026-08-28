import type {
  AirDeviceTrackAdmissionDto,
  AirDeviceTrackAdmissionRequest,
  AirDeviceUplinkSource,
} from "@translation/contracts";

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

export interface UplinkSourceAuthorizer {
  assertAuthorized(
    input: AirDeviceTrackAdmissionRequest & {
      uplinkSource: AirDeviceUplinkSource;
    },
  ): Promise<void> | void;
}

export interface LiveKitTrackBindingVerifier {
  assertTrackBinding(
    input: AirDeviceTrackAdmissionRequest & {
      uplinkSource: AirDeviceUplinkSource;
    },
  ): Promise<void> | void;
}

export async function createAirDeviceTrackAdmission(
  input: AirDeviceTrackAdmissionRequest,
  dependencies: {
    leaseVerifier: LeaseVerifier;
    callVerifier: CallBindingVerifier;
    sourceAuthorizer: UplinkSourceAuthorizer;
    trackVerifier: LiveKitTrackBindingVerifier;
    nowMs: number;
  },
): Promise<AirDeviceTrackAdmissionDto> {
  const classification = classifyAirDeviceUplinkSource(input);
  if (classification.reason !== "ok" || !Number.isFinite(dependencies.nowMs)) {
    const error = new Error("Invalid Air device track admission");
    Object.assign(error, {
      code: classification.reason !== "ok" ? classification.reason : "clock",
    });
    throw error;
  }
  const boundInput = { ...input, uplinkSource: classification.uplinkSource };
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
  await dependencies.sourceAuthorizer.assertAuthorized(boundInput);
  await dependencies.trackVerifier.assertTrackBinding(boundInput);
  return {
    uplinkSource: classification.uplinkSource,
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

export function airDeviceTrackAdmissionValidationReason(
  input: AirDeviceTrackAdmissionRequest,
) {
  return classifyAirDeviceUplinkSource(input).reason;
}

function classifyAirDeviceUplinkSource(input: AirDeviceTrackAdmissionRequest):
  | { reason: "ok"; uplinkSource: AirDeviceUplinkSource }
  | {
    reason: "communication_session_id" | "device_id" | "lease_id" |
      "track_sid" | "fencing_token" | "call_generation" | "room_name" |
      "target_identity" | "publisher_identity" | "track_name";
  } {
  const identifier = /^[A-Za-z0-9_-]+$/;
  if (!identifier.test(input.communicationSessionId) ||
    input.communicationSessionId.length > 160) {
    return { reason: "communication_session_id" };
  }
  if (!identifier.test(input.deviceId) || input.deviceId.length > 128) {
    return { reason: "device_id" };
  }
  if (!identifier.test(input.leaseId) || input.leaseId.length > 128) {
    return { reason: "lease_id" };
  }
  if (!identifier.test(input.trackSid) || input.trackSid.length > 160) {
    return { reason: "track_sid" };
  }
  if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1) {
    return { reason: "fencing_token" };
  }
  if (!Number.isInteger(input.callGeneration) || input.callGeneration < 0 ||
    input.callGeneration > 0xffffffff) return { reason: "call_generation" };

  const targetIdentity =
    `${input.communicationSessionId}:guest:air:${input.deviceId}`;
  if (input.roomName !== `call_${input.communicationSessionId}`) {
    return { reason: "room_name" };
  }
  if (input.targetParticipantIdentity !== targetIdentity) {
    return { reason: "target_identity" };
  }

  if (isTranslatedTtsPublisher(input, targetIdentity, identifier)) {
    return { reason: "ok", uplinkSource: "translated_tts" };
  }
  if (isTakeoverMicrophonePublisher(input, identifier)) {
    return { reason: "ok", uplinkSource: "takeover_microphone" };
  }

  const hasKnownPublisher = isKnownPublisherIdentity(input, identifier);
  return { reason: hasKnownPublisher ? "track_name" : "publisher_identity" };
}

function isTranslatedTtsPublisher(
  input: AirDeviceTrackAdmissionRequest,
  targetIdentity: string,
  identifier: RegExp,
) {
  if (!isTranslationWorkerIdentity(input, identifier)) return false;
  const targetToken = Buffer.from(targetIdentity).toString("base64url");
  return new RegExp(`^translation-tts-guest-[1-9][0-9]*\\.${targetToken}$`)
    .test(input.trackName);
}

function isTranslationWorkerIdentity(
  input: AirDeviceTrackAdmissionRequest,
  identifier: RegExp,
) {
  const workerPrefix = `${input.communicationSessionId}:worker:`;
  const workerSuffix = input.publisherIdentity.slice(workerPrefix.length);
  const agentPrefix = `translation-${input.communicationSessionId.slice(0, 12)}-g`;
  const agentSuffix = input.publisherIdentity.slice(agentPrefix.length);
  return (input.publisherIdentity.startsWith(workerPrefix) &&
      identifier.test(workerSuffix) && workerSuffix.length <= 128) ||
    (input.publisherIdentity.startsWith(agentPrefix) &&
      /^[1-9][0-9]*$/.test(agentSuffix));
}

function isTakeoverMicrophonePublisher(
  input: AirDeviceTrackAdmissionRequest,
  identifier: RegExp,
) {
  const hostPrefix = `${input.communicationSessionId}:host:`;
  const hostSuffix = input.publisherIdentity.slice(hostPrefix.length);
  return input.publisherIdentity.startsWith(hostPrefix) &&
    identifier.test(hostSuffix) && hostSuffix.length <= 128 &&
    input.trackName === "microphone";
}

function isKnownPublisherIdentity(
  input: AirDeviceTrackAdmissionRequest,
  identifier: RegExp,
) {
  return isTranslationWorkerIdentity(input, identifier) ||
    isTakeoverMicrophonePublisher({ ...input, trackName: "microphone" }, identifier);
}
