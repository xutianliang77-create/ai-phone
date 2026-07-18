import type { CallRoomTranslationLanguage } from "@translation/contracts";
import type {
  CallAudioSpeakerRole,
  CallTtsAudioStream,
  SynthesizedSpeech,
} from "./types.js";

export interface PlaybackInput {
  callId: string;
  segmentId: string;
  speakerRole: CallAudioSpeakerRole;
  targetLanguage: CallRoomTranslationLanguage;
  translatedText: string;
  speech: SynthesizedSpeech;
  audioStream?: CallTtsAudioStream;
}

export interface PlaybackLifecycleInput extends PlaybackInput {
  targetSpeakerRole: CallAudioSpeakerRole;
  playbackId: string;
  generation: number;
  sourceLegId?: string;
  targetLegId?: string;
  playbackReason?: PlaybackInterruptReason;
}

export interface PlaybackStartedInput extends PlaybackLifecycleInput {
  sourceLegId: string;
  targetLegId: string;
}

export type PlaybackInterruptReason =
  | "barge_in"
  | "session_end"
  | "superseded"
  | "failure";

export type PlaybackLifecycle =
  | "queued"
  | "started"
  | "interrupted"
  | "ended"
  | "failed";

export interface PlaybackInterruptionResult {
  supported: boolean;
  interrupted: boolean;
  cleared: boolean;
  playback?: PlaybackStartedInput;
}
