import {
  isLiveKitTtsAudioSupported,
  LiveKitTtsAudioSink,
  type LiveKitTtsRtcModule,
} from "./livekit-tts-audio-sink.js";
import {
  hasRtcNodeParticipantHandle,
  RtcNodeTtsTrackPermissions,
} from "./rtc-node-tts-track-permissions.js";
import type {
  LiveKitCallAudioSourceOptions,
  RtcNodeModule,
  RtcRoom,
} from "./livekit-call-audio-source-types.js";

export function attachLiveKitCallTtsSink(input: {
  room: RtcRoom;
  rtc: RtcNodeModule;
  callId: string;
  participantIdentity: string;
  worker: LiveKitCallAudioSourceOptions["worker"];
  trackAccessClient: LiveKitCallAudioSourceOptions["ttsTrackAccessClient"];
}) {
  if (!isLiveKitTtsAudioSupported(input.room, input.rtc)) return;
  let trackPermissions: RtcNodeTtsTrackPermissions | undefined;
  if (input.trackAccessClient) {
    if (!hasRtcNodeParticipantHandle(input.room.localParticipant)) {
      throw new Error("LiveKit TTS publisher permission handle is unavailable");
    }
    trackPermissions = new RtcNodeTtsTrackPermissions(input.room.localParticipant);
    trackPermissions.denyAll();
  }
  input.worker.addTtsAudioSink(new LiveKitTtsAudioSink({
    room: input.room,
    rtc: input.rtc as LiveKitTtsRtcModule,
    ...(input.trackAccessClient ? {
      trackPermissions,
      trackAccess: {
        authorizeTrack: (request) =>
          input.trackAccessClient!.authorizeTrack(input.callId, {
            workerIdentity: input.participantIdentity,
            ...request,
          }),
      },
    } : {}),
  }));
}
