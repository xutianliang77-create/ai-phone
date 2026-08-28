import 'package:livekit_client/livekit_client.dart' as livekit;
import 'call_room_client.dart';
import 'call_room_participant_policy.dart';

extension LiveKitCallRoomSnapshot on CallRoomSnapshot {
  CallRoomSnapshot fromLiveKitRoom(
    livekit.Room room, {
    CallRoomConnectionStatus? status,
    bool? microphoneEnabled,
    bool? microphonePausedForPlayback,
    String? message,
    List<CallRoomCaption>? captions,
    CallRoomConversationState? conversationState,
    CallRoomPlaybackState? playbackState,
    String? activePlaybackId,
    int? pipelineGeneration,
    String? lastEventType,
    bool clearActivePlaybackId = false,
  }) {
    final participant = room.localParticipant;
    return copyWith(
      status: status ?? this.status,
      microphoneEnabled:
          microphoneEnabled ?? (participant?.isMicrophoneEnabled() ?? false),
      microphonePausedForPlayback: microphonePausedForPlayback,
      remoteParticipantCount: room.remoteParticipants.values
          .where(
              (participant) => isHumanCallRoomParticipant(participant.identity))
          .length,
      audibleRemoteAudioParticipantIdentities: room.remoteParticipants.values
          .where((remote) => remote.audioTrackPublications.any(
                (publication) => publication.subscribed &&
                    !publication.muted &&
                    publication.track != null,
              ))
          .map((remote) => remote.identity)
          .toSet(),
      message: message,
      captions: captions,
      conversationState: conversationState,
      playbackState: playbackState,
      activePlaybackId: activePlaybackId,
      pipelineGeneration: pipelineGeneration,
      lastEventType: lastEventType,
      clearActivePlaybackId: clearActivePlaybackId,
    );
  }
}
