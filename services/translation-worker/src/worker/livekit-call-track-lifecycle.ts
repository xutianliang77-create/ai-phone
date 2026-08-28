import type { CallInputTrackAccessAuthorizer } from
  "./call-input-track-access-client.js";
import { participantRole } from "./livekit-call-participant.js";
import type {
  LiveKitCallAudioTrackLifecycleEvent,
  RtcNodeModule,
  RtcRemoteTrackPublication,
} from "./livekit-call-audio-source-types.js";
import {
  isAudioPublication,
  isRemoteAudioTrack,
  shouldForwardAudioTrack,
} from "./livekit-call-audio-utils.js";
import type { CallAudioSpeakerRole } from "./types.js";

type TrackObserver = (event: LiveKitCallAudioTrackLifecycleEvent) => void;

export class LiveKitCallTrackLifecycle {
  private workerBinding?: {
    identity: string;
    dispatchGeneration?: number;
  };
  private readonly admittedRoleByTrackSid = new Map<
    string,
    CallAudioSpeakerRole
  >();

  constructor(private readonly options: {
    callId: string;
    access?: CallInputTrackAccessAuthorizer;
    observer?: TrackObserver;
  }) {}

  bindWorker(identity: string, dispatchGeneration?: number) {
    this.workerBinding = {
      identity,
      ...(dispatchGeneration === undefined ? {} : { dispatchGeneration }),
    };
  }

  async subscribePublication(
    publication: unknown,
    participant: unknown,
    rtc: RtcNodeModule,
  ) {
    const value = publication as RtcRemoteTrackPublication;
    const fallbackRole = participantRole(participant);
    let speakerRole: CallAudioSpeakerRole | null = fallbackRole;
    let outcome: LiveKitCallAudioTrackLifecycleEvent["outcome"];
    if (!shouldForwardAudioTrack(undefined, value)) {
      outcome = "ignored_translation_tts";
    } else if (!isAudioPublication(value, rtc)) {
      outcome = "ignored_non_audio";
    } else {
      speakerRole = await this.authorize(value, participant, fallbackRole);
      outcome = !speakerRole
        ? this.options.access ? "ignored_binding" : "ignored_unknown_role"
        : typeof value.setSubscribed !== "function"
        ? "subscription_unsupported"
        : "subscription_requested";
    }
    this.emit({
      event: "publication_observed",
      speakerRole,
      outcome,
      publicationKind: safePublicationKind(value.kind),
    });
    if (typeof value.setSubscribed === "function") {
      value.setSubscribed(outcome === "subscription_requested");
    }
  }

  async acceptSubscribedTrack(
    track: unknown,
    publication: unknown,
    participant: unknown,
    rtc: RtcNodeModule,
  ): Promise<CallAudioSpeakerRole | null> {
    const value = publication as RtcRemoteTrackPublication;
    const fallbackRole = participantRole(participant);
    let speakerRole: CallAudioSpeakerRole | null = fallbackRole;
    let outcome: LiveKitCallAudioTrackLifecycleEvent["outcome"];
    if (!shouldForwardAudioTrack(track, value)) {
      outcome = "ignored_translation_tts";
    } else if (!isRemoteAudioTrack(track, rtc.RemoteAudioTrack)) {
      outcome = "ignored_non_audio";
    } else {
      speakerRole = await this.authorize(value, participant, fallbackRole);
      outcome = speakerRole
        ? "accepted"
        : this.options.access ? "ignored_binding" : "ignored_unknown_role";
    }
    this.emit({ event: "track_subscribed", speakerRole, outcome });
    if (!speakerRole && typeof value.setSubscribed === "function") {
      value.setSubscribed(false);
    }
    return outcome === "accepted" ? speakerRole : null;
  }

  forgetPublication(publication: unknown) {
    const sid = publicationSid(publication);
    if (sid) this.admittedRoleByTrackSid.delete(sid);
  }

  clear() {
    this.admittedRoleByTrackSid.clear();
  }

  legStarted(speakerRole: CallAudioSpeakerRole) {
    this.emit({ event: "audio_leg_started", speakerRole, outcome: "accepted" });
  }

  duplicateRoleIgnored(speakerRole: CallAudioSpeakerRole) {
    this.emit({
      event: "track_subscribed",
      speakerRole,
      outcome: "ignored_duplicate_role",
    });
  }

  private async authorize(
    publication: RtcRemoteTrackPublication,
    participant: unknown,
    fallbackRole: CallAudioSpeakerRole | null,
  ) {
    if (!this.options.access) return fallbackRole;
    const trackSid = publicationSid(publication);
    const cached = trackSid
      ? this.admittedRoleByTrackSid.get(trackSid)
      : undefined;
    if (cached) return cached;
    const trackName = publicationName(publication);
    const participantIdentity = remoteParticipantIdentity(participant);
    if (!trackSid || !trackName || !participantIdentity || !this.workerBinding) {
      return null;
    }
    try {
      const result = await this.options.access.authorizeTrack(
        this.options.callId,
        {
          workerIdentity: this.workerBinding.identity,
          ...(this.workerBinding.dispatchGeneration === undefined
            ? {}
            : { dispatchGeneration: this.workerBinding.dispatchGeneration }),
          participantIdentity,
          trackSid,
          trackName,
        },
      );
      this.admittedRoleByTrackSid.set(trackSid, result.speakerRole);
      return result.speakerRole;
    } catch {
      return null;
    }
  }

  private emit(event: LiveKitCallAudioTrackLifecycleEvent) {
    try {
      this.options.observer?.(event);
    } catch {
      // Observability must not apply backpressure to the media path.
    }
  }
}

function publicationSid(publication: unknown) {
  const sid = (publication as { sid?: unknown }).sid;
  return typeof sid === "string" && sid ? sid : null;
}

function publicationName(publication: unknown) {
  const name = (publication as { name?: unknown }).name;
  return typeof name === "string" && name ? name : null;
}

function remoteParticipantIdentity(participant: unknown) {
  const identity = (participant as { identity?: unknown }).identity;
  return typeof identity === "string" && identity ? identity : null;
}

function safePublicationKind(kind: unknown) {
  return typeof kind === "number" || typeof kind === "string" ? kind : null;
}
