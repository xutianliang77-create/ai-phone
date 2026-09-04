import {
  VuartV1HelloPayloadError,
  type VuartV1HelloPayload,
} from "./vuart-v1-command-payload.js";
import { VuartFrameType } from "./vuart-frame.js";

export type AirDeviceBootInvalidFrameReason =
  | "frame_flags_unsupported"
  | "hello_payload_invalid"
  | "hello_protocol_unsupported"
  | "hello_capability_unsupported"
  | "hello_required_capability_missing"
  | "hello_audio_capacity_unsupported"
  | "heartbeat_payload_invalid"
  | "device_identity_mismatch"
  | "hello_changed_within_boot";

export interface AirDeviceBootAdmissionPolicy {
  requiredCapabilityFlags: number;
  minimumMaxPayloadBytes: number;
}

export function airDeviceBootAdmissionPolicy(input: {
  requiredCapabilityFlags?: number;
  minimumMaxPayloadBytes?: number;
}): AirDeviceBootAdmissionPolicy {
  const requiredCapabilityFlags = input.requiredCapabilityFlags ?? 0;
  const minimumMaxPayloadBytes = input.minimumMaxPayloadBytes ?? 6_461;
  if (!Number.isInteger(requiredCapabilityFlags) || requiredCapabilityFlags < 0 ||
    requiredCapabilityFlags > 0x0f) {
    throw new Error("requiredCapabilityFlags contains unsupported bits");
  }
  if (!Number.isInteger(minimumMaxPayloadBytes) ||
    minimumMaxPayloadBytes < 6_461 || minimumMaxPayloadBytes > 0xffff) {
    throw new Error("minimumMaxPayloadBytes is outside the VUART v1 range");
  }
  return { requiredCapabilityFlags, minimumMaxPayloadBytes };
}

export function airDeviceHelloPolicyRejection(
  hello: VuartV1HelloPayload,
  policy: AirDeviceBootAdmissionPolicy,
): AirDeviceBootInvalidFrameReason | null {
  if ((hello.capabilityFlags & policy.requiredCapabilityFlags) !==
    policy.requiredCapabilityFlags) {
    return "hello_required_capability_missing";
  }
  if (hello.maxPayloadBytes < policy.minimumMaxPayloadBytes) {
    return "hello_audio_capacity_unsupported";
  }
  return null;
}

export function airDeviceBootInvalidPayloadReason(
  frameType: number,
  error: unknown,
): AirDeviceBootInvalidFrameReason {
  if (frameType !== VuartFrameType.HELLO) return "heartbeat_payload_invalid";
  if (!(error instanceof VuartV1HelloPayloadError)) {
    return "hello_payload_invalid";
  }
  if (error.code === "protocol_version_unsupported") {
    return "hello_protocol_unsupported";
  }
  if (error.code === "capability_flags_unsupported") {
    return "hello_capability_unsupported";
  }
  return "hello_audio_capacity_unsupported";
}
