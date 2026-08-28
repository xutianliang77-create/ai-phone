import {
  ParticipantTrackPermission,
  SetTrackSubscriptionPermissionsRequest,
  type SetTrackSubscriptionPermissionsResponse,
} from "@livekit/rtc-ffi-bindings";

interface RtcNodeLocalParticipantHandle {
  ffi_handle: { handle: bigint };
}

interface RtcNodeFfiClient {
  request<T>(request: object): T;
}

/**
 * rtc-node 0.13.30 exposes the participant handle and initializes one global
 * FFI client, but does not wrap this supported FFI request. Keep this adapter
 * version-pinned and fail closed if that invariant changes.
 */
export function setRtcNodeTrackSubscriptionPermissions(
  participant: RtcNodeLocalParticipantHandle,
  allowedParticipantIdentities: string[],
) {
  const ffi = (globalThis as typeof globalThis & {
    _ffiClientInstance?: RtcNodeFfiClient;
  })._ffiClientInstance;
  if (!ffi || typeof ffi.request !== "function") {
    throw new Error("LiveKit RTC subscription permission API is unavailable");
  }
  const unique = [...new Set(allowedParticipantIdentities)].sort();
  if (unique.some((identity) => !identity || Buffer.byteLength(identity) > 256)) {
    throw new Error("LiveKit RTC subscriber identity is invalid");
  }
  ffi.request<SetTrackSubscriptionPermissionsResponse>({
    message: {
      case: "setTrackSubscriptionPermissions",
      value: new SetTrackSubscriptionPermissionsRequest({
        localParticipantHandle: participant.ffi_handle.handle,
        allParticipantsAllowed: false,
        permissions: unique.map((participantIdentity) =>
          new ParticipantTrackPermission({
            participantIdentity,
            allowAll: true,
            allowedTrackSids: [],
          })),
      }),
    },
  });
}
