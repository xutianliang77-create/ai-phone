import {
  isAnsweredSipStatus,
  liveKitSipParticipant,
  sipCallStatus,
} from "./livekit-call-participant.js";
import type {
  CallSipStatusReporter,
  LiveKitSipCallStatus,
} from "./call-sip-status-client.js";
import type { RtcNodeModule } from "./livekit-call-audio-source-types.js";
import type { CallAudioSpeakerRole } from "./types.js";

interface PendingSipTrack {
  track: unknown;
  speakerRole: CallAudioSpeakerRole;
  identity: string;
  rtc: RtcNodeModule;
}

interface LiveKitCallSipTrackGateOptions {
  callId: string;
  statusClient?: CallSipStatusReporter;
  reportError: (error: unknown) => void;
  startAudioTrack: (
    track: unknown,
    speakerRole: CallAudioSpeakerRole,
    rtc: RtcNodeModule,
  ) => Promise<void>;
}

export class LiveKitCallSipTrackGate {
  private readonly pendingTracks = new Map<unknown, PendingSipTrack>();
  private readonly reportedStatuses = new Set<string>();

  constructor(private readonly options: LiveKitCallSipTrackGateOptions) {}

  async allowTrack(input: {
    track: unknown;
    speakerRole: CallAudioSpeakerRole;
    participant: unknown;
    rtc: RtcNodeModule;
  }) {
    const sipParticipant = liveKitSipParticipant(input.participant);
    if (!sipParticipant) return true;
    const status = sipCallStatus(input.participant);
    if (isAnsweredSipStatus(status) &&
      await this.reportStatus(sipParticipant, input.participant, status)) {
      return true;
    }
    this.pendingTracks.set(input.track, {
      track: input.track,
      speakerRole: input.speakerRole,
      identity: sipParticipant.identity,
      rtc: input.rtc,
    });
    return false;
  }

  async handleParticipantAttributesChanged(participant: unknown) {
    const sipParticipant = liveKitSipParticipant(participant);
    const status = sipCallStatus(participant);
    if (!sipParticipant || !status ||
      !await this.reportStatus(sipParticipant, participant, status) ||
      !isAnsweredSipStatus(status)) return;
    for (const [track, pending] of this.pendingTracks) {
      if (pending.identity !== sipParticipant.identity) continue;
      this.pendingTracks.delete(track);
      await this.options.startAudioTrack(
        pending.track,
        pending.speakerRole,
        pending.rtc,
      );
    }
  }

  clear() {
    this.pendingTracks.clear();
  }

  private async reportStatus(
    binding: { identity: string; operationId: string },
    participant: unknown,
    status: LiveKitSipCallStatus,
  ) {
    if (!this.options.statusClient) return false;
    const reportKey = `${binding.identity}:${status}`;
    if (this.reportedStatuses.has(reportKey)) return true;
    const value = participant as {
      sid?: unknown;
      attributes?: Record<string, string>;
    };
    try {
      await this.options.statusClient.reportStatus(this.options.callId, {
        operationId: binding.operationId,
        participantIdentity: binding.identity,
        callStatus: status,
        ...(typeof value.sid === "string" ? { participantSid: value.sid } : {}),
        ...(value.attributes?.["sip.callID"]
          ? { sipCallId: value.attributes["sip.callID"] }
          : {}),
      });
    } catch (error) {
      this.options.reportError(error);
      return false;
    }
    this.reportedStatuses.add(reportKey);
    return true;
  }
}
