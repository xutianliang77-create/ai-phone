import { deviceSpeakerProfile, isDeviceSpeakerSelection, type SpeakerAttributionOptionsDto } from "@translation/contracts";

/** Operator rollout gate is separate from phone-local resource readiness. It
 * neither enables a server speaker model nor changes supplier qualifications. */
export function publicDeviceSpeakerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.PUBLIC_DEVICE_SPEAKER_ENABLED === "true";
}
export function publicSpeakerSelectionAllowed(value: SpeakerAttributionOptionsDto | undefined) {
  return value?.mode === "off" && !value.allowVoiceIdentity && value.deviceProfile === undefined ||
    publicDeviceSpeakerEnabled() && isDeviceSpeakerSelection(value);
}
export function publicDeviceSpeakerCapability() {
  return { available: publicDeviceSpeakerEnabled(), ...deviceSpeakerProfile,
    execution: "on_device" as const, anonymousOnly: true, requiresLocalReadiness: true };
}
