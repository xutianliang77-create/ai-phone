import {
  participantTrackSpeaker,
  type CallRoomTranslationLanguage,
} from "@translation/contracts";
import {
  SegmentAssembler,
  type SpeechTranscript,
} from "@translation/speech-quality";
import type { CallAudioSpeakerRole } from "./types.js";

export interface BufferedCallTranscript {
  speakerRole: CallAudioSpeakerRole;
  transcript: CallSpeechTranscript;
}

type CallSpeechTranscript = Omit<SpeechTranscript, "language"> & {
  language: CallRoomTranslationLanguage;
};

export class ParticipantTurnBuffer {
  private readonly assembler: SegmentAssembler;
  private readonly activeRoles = new Map<string, CallAudioSpeakerRole>();

  constructor(assembler = new SegmentAssembler()) {
    this.assembler = assembler;
  }

  push(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    transcript: CallSpeechTranscript,
    nowMs = Date.now(),
  ) {
    const ready: BufferedCallTranscript[] = [];
    const previousRole = this.activeRoles.get(callId);
    if (previousRole && previousRole !== speakerRole) {
      ready.push(...this.flush(callId, previousRole, nowMs));
    }
    this.activeRoles.set(callId, speakerRole);
    const attributed = {
      ...transcript,
      speaker: participantTrackSpeaker(speakerRole),
    };
    const result = this.assembler.push(
      participantKey(callId, speakerRole),
      attributed,
      nowMs,
    );
    ready.push(...result.ready.map((item) => ({
      speakerRole,
      transcript: asCallTranscript(item),
    })));
    return ready;
  }

  drainExpired(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    nowMs = Date.now(),
  ) {
    return this.assembler
      .drainExpired(participantKey(callId, speakerRole), nowMs)
      .map((transcript) => ({
        speakerRole,
        transcript: asCallTranscript(transcript),
      }));
  }

  flush(
    callId: string,
    speakerRole: CallAudioSpeakerRole,
    nowMs = Date.now(),
  ) {
    return this.assembler
      .flush(participantKey(callId, speakerRole), nowMs)
      .map((transcript) => ({
        speakerRole,
        transcript: asCallTranscript(transcript),
      }));
  }

  clear(callId: string) {
    this.assembler.clear(participantKey(callId, "host"));
    this.assembler.clear(participantKey(callId, "guest"));
    this.activeRoles.delete(callId);
  }
}

function participantKey(callId: string, speakerRole: CallAudioSpeakerRole) {
  return `${callId}:${speakerRole}`;
}

function asCallTranscript(transcript: SpeechTranscript): CallSpeechTranscript {
  if (transcript.language !== "zh" && transcript.language !== "en") {
    throw new Error(`Unsupported Call Link language: ${transcript.language}`);
  }
  return transcript as CallSpeechTranscript;
}
