import 'package:livekit_client/livekit_client.dart' as livekit;
import 'call_room_audio_track_policy.dart';
import 'call_room_participant_policy.dart';

class LiveKitCallRoomSubscriptionController {
  const LiveKitCallRoomSubscriptionController({
    required this.callId,
    required this.localRole,
    required this.localParticipantIdentity,
    required this.translationMediaOnly,
    required this.airTakeoverUplink,
  });

  final String callId;
  final String localRole;
  final String localParticipantIdentity;
  final bool translationMediaOnly;
  final bool airTakeoverUplink;

  void syncLocalTrackPermissions(livekit.Room room) {
    if (airTakeoverUplink) {
      final airPermissions = room.remoteParticipants.values
          .where((participant) => isBoundAirDeviceCallRoomParticipant(
                callId: callId,
                participantIdentity: participant.identity,
                attributes: participant.attributes,
              ))
          .map((participant) => livekit.ParticipantTrackPermission(
                participant.identity,
                true,
                null,
              ))
          .toList(growable: false);
      room.localParticipant?.setTrackSubscriptionPermissions(
        allParticipantsAllowed: false,
        trackPermissions: airPermissions,
      );
      return;
    }
    final workerPermissions = room.remoteParticipants.values
        .where(_isBoundTranslationWorker)
        .map((participant) => livekit.ParticipantTrackPermission(
              participant.identity,
              true,
              null,
            ))
        .toList(growable: false);
    room.localParticipant?.setTrackSubscriptionPermissions(
      allParticipantsAllowed: false,
      trackPermissions: workerPermissions,
    );
  }

  Future<void> syncRemoteAudioSubscriptions(livekit.Room room) async {
    for (final participant in room.remoteParticipants.values) {
      for (final publication in participant.audioTrackPublications) {
        await subscribeRemoteAudioPublication(publication, participant);
      }
    }
  }

  Future<void> subscribeRemoteAudioPublication(
    livekit.RemoteTrackPublication publication,
    livekit.RemoteParticipant participant,
  ) async {
    if (publication.kind != livekit.TrackType.AUDIO) return;
    if (!_allows(publication, participant)) {
      await publication.unsubscribe();
      return;
    }
    await publication.subscribe();
  }

  Future<void> ensureSubscribedAudioPublicationAllowed(
    livekit.RemoteTrackPublication publication,
    livekit.RemoteParticipant participant,
  ) async {
    if (publication.kind == livekit.TrackType.AUDIO &&
        !_allows(publication, participant)) {
      await publication.unsubscribe();
    }
  }

  bool _allows(
    livekit.RemoteTrackPublication publication,
    livekit.RemoteParticipant participant,
  ) {
    final allowedByTrack = shouldSubscribeCallRoomAudioTrack(
      trackName: publication.name,
      localRole: localRole,
      localParticipantIdentity: localParticipantIdentity,
      translationMediaOnly: translationMediaOnly,
    );
    if (!allowedByTrack) return false;
    // AI calling and human takeover intentionally retain full-room monitoring.
    if (!translationMediaOnly && localRole == 'host') return true;
    return _isBoundTranslationWorker(participant);
  }

  bool _isBoundTranslationWorker(
    livekit.RemoteParticipant participant,
  ) {
    return isBoundTranslationWorkerCallRoomParticipant(
      callId: callId,
      participantIdentity: participant.identity,
      isAgent: participant.kind == livekit.ParticipantKind.AGENT,
      attributes: participant.attributes,
      metadata: participant.metadata,
    );
  }
}
