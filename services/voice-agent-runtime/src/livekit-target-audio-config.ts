import { voice } from "@livekit/agents";
import type { Room } from "@livekit/rtc-node";
import {
  LiveKitTargetAudioOutput,
  type TargetAudioRtc,
  type VoiceAgentAudioCapacityEvidence,
} from "./livekit-target-audio-output.js";

export const liveKitVoiceAgentRoomOutputOptions = {
  audioEnabled: false,
  transcriptionEnabled: true,
  syncTranscription: false,
} as const;

const liveKitDefaultRoomOutputOptions = {
  audioEnabled: true,
  transcriptionEnabled: true,
  syncTranscription: true,
} as const;

export function configureVoiceAgentTargetAudio(
  session: { output: { audio: voice.AudioOutput | null } },
  options: ConstructorParameters<typeof LiveKitTargetAudioOutput>[0],
) {
  const output = new LiveKitTargetAudioOutput(options);
  session.output.audio = output;
  return output;
}

export function configureVoiceAgentSessionAudio(
  session: { output: { audio: voice.AudioOutput | null } },
  input: {
    room: Room;
    telephonyProvider: "air780_volte" | "livekit_sip";
    publisherIdentity: string;
    targetParticipantIdentity: string;
    rtc?: TargetAudioRtc;
    maxPendingAudioMs?: number;
    maxPendingAudioChunks?: number;
    onCapacityExceeded?: (
      evidence: VoiceAgentAudioCapacityEvidence,
    ) => void | Promise<void>;
  },
) {
  if (input.telephonyProvider !== "air780_volte") {
    return {
      output: undefined,
      abortController: undefined,
      roomOutputOptions: liveKitDefaultRoomOutputOptions,
    };
  }
  const abortController = new AbortController();
  const output = configureVoiceAgentTargetAudio(session, {
    room: input.room,
    publisherIdentity: input.publisherIdentity,
    targetParticipantIdentity: input.targetParticipantIdentity,
    ...(input.rtc ? { rtc: input.rtc } : {}),
    ...(input.maxPendingAudioMs !== undefined
      ? { maxPendingAudioMs: input.maxPendingAudioMs }
      : {}),
    ...(input.maxPendingAudioChunks !== undefined
      ? { maxPendingAudioChunks: input.maxPendingAudioChunks }
      : {}),
    ...(input.onCapacityExceeded
      ? { onCapacityExceeded: input.onCapacityExceeded }
      : {}),
  });
  return {
    output,
    abortController,
    roomOutputOptions: liveKitVoiceAgentRoomOutputOptions,
  };
}
