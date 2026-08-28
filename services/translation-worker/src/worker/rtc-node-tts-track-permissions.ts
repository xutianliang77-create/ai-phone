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

export class RtcNodeTtsTrackPermissions {
  private readonly trackSidsByParticipant = new Map<string, Set<string>>();

  constructor(private readonly participant: RtcNodeLocalParticipantHandle) {}

  denyAll() {
    this.apply();
  }

  allowTrack(participantIdentity: string, trackSid: string) {
    assertIdentity(participantIdentity);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(trackSid)) {
      throw new Error("LiveKit TTS track SID is invalid");
    }
    const trackSids = this.trackSidsByParticipant.get(participantIdentity) ??
      new Set<string>();
    trackSids.add(trackSid);
    this.trackSidsByParticipant.set(participantIdentity, trackSids);
    this.apply();
  }

  private apply() {
    const ffi = (globalThis as typeof globalThis & {
      _ffiClientInstance?: RtcNodeFfiClient;
    })._ffiClientInstance;
    if (!ffi || typeof ffi.request !== "function") {
      throw new Error("LiveKit RTC TTS subscription permission API is unavailable");
    }
    const permissions = [...this.trackSidsByParticipant.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([participantIdentity, trackSids]) =>
        new ParticipantTrackPermission({
          participantIdentity,
          allowAll: false,
          allowedTrackSids: [...trackSids].sort(),
        })
      );
    ffi.request<SetTrackSubscriptionPermissionsResponse>({
      message: {
        case: "setTrackSubscriptionPermissions",
        value: new SetTrackSubscriptionPermissionsRequest({
          localParticipantHandle: this.participant.ffi_handle.handle,
          allParticipantsAllowed: false,
          permissions,
        }),
      },
    });
  }
}

export function hasRtcNodeParticipantHandle(
  participant: unknown,
): participant is RtcNodeLocalParticipantHandle {
  const handle = (participant as {
    ffi_handle?: { handle?: unknown };
  } | undefined)?.ffi_handle?.handle;
  return typeof handle === "bigint";
}

function assertIdentity(value: string) {
  if (!value || Buffer.byteLength(value) > 256) {
    throw new Error("LiveKit TTS target identity is invalid");
  }
}
