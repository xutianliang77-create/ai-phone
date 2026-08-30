export type EnterpriseGuestMicrophoneCheckStatus =
  | "idle"
  | "checking"
  | "ready"
  | "denied"
  | "not_found"
  | "unavailable"
  | "failed";

export interface EnterpriseGuestMicrophoneCheckResult {
  status: Exclude<EnterpriseGuestMicrophoneCheckStatus, "idle" | "checking">;
  reasonCode?: string;
}

interface GuestMicrophoneEnvironment {
  secureContext: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export async function checkEnterpriseGuestMicrophone(
  environment: GuestMicrophoneEnvironment = browserEnvironment(),
): Promise<EnterpriseGuestMicrophoneCheckResult> {
  if (!environment.secureContext || !environment.getUserMedia) {
    return { status: "unavailable", reasonCode: "microphone_api_unavailable" };
  }
  let stream: MediaStream | undefined;
  try {
    stream = await environment.getUserMedia({ audio: true, video: false });
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) {
      return { status: "not_found", reasonCode: "microphone_not_found" };
    }
    return { status: "ready" };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return { status: "denied", reasonCode: "microphone_permission_denied" };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { status: "not_found", reasonCode: "microphone_not_found" };
    }
    if (name === "NotReadableError" || name === "AbortError") {
      return { status: "failed", reasonCode: "microphone_not_readable" };
    }
    return { status: "failed", reasonCode: "microphone_check_failed" };
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}

function browserEnvironment(): GuestMicrophoneEnvironment {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  return {
    secureContext: globalThis.isSecureContext === true,
    getUserMedia: mediaDevices?.getUserMedia
      ? (constraints) => mediaDevices.getUserMedia(constraints)
      : undefined,
  };
}
