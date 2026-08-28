part of 'livekit_call_room_client.dart';

extension _LiveKitCallRoomPolicySync on LiveKitCallRoomClient {
  void _resyncSubscriptionPolicy(livekit.Room room) {
    final subscriptions = _subscriptions;
    if (subscriptions == null || !identical(_room, room)) return;
    unawaited(_applySubscriptionPolicy(room, subscriptions));
  }

  Future<void> _applySubscriptionPolicy(
    livekit.Room room,
    LiveKitCallRoomSubscriptionController subscriptions,
  ) async {
    try {
      subscriptions.syncLocalTrackPermissions(room);
      await subscriptions.syncRemoteAudioSubscriptions(room);
    } on Object {
      await _failClosedMediaPolicy(room, subscriptions);
    }
  }

  void _applyRemotePublicationPolicy(
    livekit.Room room,
    livekit.RemoteTrackPublication publication,
    livekit.RemoteParticipant participant, {
    required bool alreadySubscribed,
  }) {
    final subscriptions = _subscriptions;
    if (subscriptions == null || !identical(_room, room)) return;
    unawaited(_enforceRemotePublicationPolicy(
      room,
      subscriptions,
      publication,
      participant,
      alreadySubscribed: alreadySubscribed,
    ));
  }

  Future<void> _enforceRemotePublicationPolicy(
    livekit.Room room,
    LiveKitCallRoomSubscriptionController subscriptions,
    livekit.RemoteTrackPublication publication,
    livekit.RemoteParticipant participant, {
    required bool alreadySubscribed,
  }) async {
    try {
      if (alreadySubscribed) {
        await subscriptions.ensureSubscribedAudioPublicationAllowed(
          publication,
          participant,
        );
      } else {
        await subscriptions.subscribeRemoteAudioPublication(
          publication,
          participant,
        );
      }
    } on Object {
      await _failClosedMediaPolicy(room, subscriptions);
    }
  }

  Future<void> _failClosedMediaPolicy(
    livekit.Room room,
    LiveKitCallRoomSubscriptionController subscriptions,
  ) async {
    if (!identical(_room, room) || !identical(_subscriptions, subscriptions)) {
      return;
    }
    await _disposeRoom(disconnectFirst: true);
    _emit(const CallRoomSnapshot.disconnected(
      message: 'Call room media permissions could not be refreshed',
    ));
  }
}
