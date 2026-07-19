import type { CallAudioSpeakerRole } from "./types.js";
import type {
  LiveKitCallAudioTrackLifecycleEvent,
  RtcNodeModule,
  RtcRemoteTrackPublication,
} from "./livekit-call-audio-source-types.js";
import { participantRole } from "./livekit-call-participant.js";
import {
  isAudioPublication,
  isRemoteAudioTrack,
  shouldForwardAudioTrack,
} from "./livekit-call-audio-utils.js";

type TrackObserver = (event: LiveKitCallAudioTrackLifecycleEvent) => void;

export class LiveKitCallTrackLifecycle {
  constructor(private readonly observer?: TrackObserver) {}

  subscribePublication(
    publication: unknown,
    participant: unknown,
    rtc: RtcNodeModule,
  ) {
    const value = publication as RtcRemoteTrackPublication;
    const speakerRole = participantRole(participant);
    const outcome = !speakerRole
      ? "ignored_unknown_role"
      : !shouldForwardAudioTrack(undefined, value)
        ? "ignored_translation_tts"
        : !isAudioPublication(value, rtc)
          ? "ignored_non_audio"
          : typeof value.setSubscribed !== "function"
            ? "subscription_unsupported"
            : "subscription_requested";
    this.emit({
      event: "publication_observed",
      speakerRole,
      outcome,
      publicationKind: safePublicationKind(value.kind),
    });
    if (outcome === "subscription_requested") value.setSubscribed!(true);
  }

  acceptSubscribedTrack(
    track: unknown,
    publication: unknown,
    participant: unknown,
    rtc: RtcNodeModule,
  ): CallAudioSpeakerRole | null {
    const speakerRole = participantRole(participant);
    const outcome = !shouldForwardAudioTrack(track, publication)
      ? "ignored_translation_tts"
      : !speakerRole
        ? "ignored_unknown_role"
        : !isRemoteAudioTrack(track, rtc.RemoteAudioTrack)
          ? "ignored_non_audio"
          : "accepted";
    this.emit({ event: "track_subscribed", speakerRole, outcome });
    return outcome === "accepted" ? speakerRole : null;
  }

  legStarted(speakerRole: CallAudioSpeakerRole) {
    this.emit({ event: "audio_leg_started", speakerRole, outcome: "accepted" });
  }

  private emit(event: LiveKitCallAudioTrackLifecycleEvent) {
    try {
      this.observer?.(event);
    } catch {
      // Observability must not apply backpressure to the media path.
    }
  }
}

function safePublicationKind(kind: unknown) {
  return typeof kind === "number" || typeof kind === "string" ? kind : null;
}
