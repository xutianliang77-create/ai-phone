part of 'livekit_call_room_client.dart';

extension _LiveKitCallRoomEvents on LiveKitCallRoomClient {
  void _listenToRoom(
    livekit.Room room,
    livekit.EventsListener<livekit.RoomEvent> listener, {
    required String callId,
    required String roomName,
    required String localRole,
  }) {
    listener
      ..on<livekit.RoomConnectedEvent>((_) {
        _emit(_current.fromLiveKitRoom(
          room,
          status: CallRoomConnectionStatus.connected,
        ));
      })
      ..on<livekit.RoomReconnectingEvent>((_) {
        _emit(_current.fromLiveKitRoom(
          room,
          status: CallRoomConnectionStatus.reconnecting,
        ));
      })
      ..on<livekit.RoomReconnectedEvent>((_) {
        _resyncSubscriptionPolicy(room);
        _emit(_current.fromLiveKitRoom(
          room,
          status: CallRoomConnectionStatus.connected,
        ));
      })
      ..on<livekit.ParticipantConnectedEvent>((_) {
        _resyncSubscriptionPolicy(room);
        _emit(_current.fromLiveKitRoom(room));
      })
      ..on<livekit.ParticipantDisconnectedEvent>((_) {
        _resyncSubscriptionPolicy(room);
        _emit(_current.fromLiveKitRoom(room));
      })
      ..on<livekit.ParticipantAttributesChanged>((_) {
        _resyncSubscriptionPolicy(room);
      })
      ..on<livekit.ParticipantMetadataUpdatedEvent>((_) {
        _resyncSubscriptionPolicy(room);
      })
      ..on<livekit.TrackPublishedEvent>((event) {
        _applyRemotePublicationPolicy(
          room,
          event.publication,
          event.participant,
          alreadySubscribed: false,
        );
      })
      ..on<livekit.TrackSubscribedEvent>((event) {
        _applyRemotePublicationPolicy(
          room,
          event.publication,
          event.participant,
          alreadySubscribed: true,
        );
        _emit(_current.fromLiveKitRoom(room));
      })
      ..on<livekit.TrackUnsubscribedEvent>((_) {
        _emit(_current.fromLiveKitRoom(room));
      })
      ..on<livekit.TrackMutedEvent>((_) {
        _emit(_current.fromLiveKitRoom(room));
      })
      ..on<livekit.TrackUnmutedEvent>((_) {
        _emit(_current.fromLiveKitRoom(room));
      })
      ..on<livekit.DataReceivedEvent>((event) {
        if (isTrustedCallRoomDataPacket(
          topic: event.topic,
          senderIdentity: event.participant?.identity,
        )) {
          _handleDataMessage(
            room,
            event.data,
            callId: callId,
            roomName: roomName,
            localRole: localRole,
          );
          return;
        }
        if (event.topic == agentDeliveryRoomTopic &&
            event.participant == null) {
          _handleAgentDeliveryMessage(
            event.data,
            sessionId: callId,
            participantIdentity: room.localParticipant?.identity ?? '',
          );
        }
      })
      ..on<livekit.RoomDisconnectedEvent>((event) {
        _fullDuplexEnabled = false;
        _duplexDegraded = false;
        _subscriptions = null;
        _emit(CallRoomSnapshot.disconnected(
          message: event.reason == null ? null : 'LiveKit: ${event.reason}',
        ));
      });
  }

  void _handleDataMessage(
    livekit.Room room,
    List<int> data, {
    required String callId,
    required String roomName,
    required String localRole,
  }) {
    final payload = parseCallRoomData(
      data,
      expectedCallId: callId,
      expectedRoomName: roomName,
    );
    if (!_eventState.accept(
      pipelineGeneration: payload.pipelineGeneration,
      playbackId: payload.playbackId,
      playbackGeneration: payload.generation,
    )) {
      return;
    }
    if (payload.duplexMode == 'half_duplex') {
      _duplexDegraded = true;
    } else if (payload.duplexMode == 'full_duplex') {
      _duplexDegraded = false;
    }
    final caption = payload.caption;
    final remotePlayback = payload.speakerRole != null &&
        payload.speakerRole != localRole &&
        payload.playbackId != null;
    if (remotePlayback && payload.eventType == 'playback.started') {
      unawaited(_ttsCapture.onPlaybackStarted(
        room: room,
        playbackId: payload.playbackId!,
        generation: payload.generation,
        audioDurationMs: caption?.audioDurationMs,
        fullDuplexEnabled: _fullDuplexEnabled,
        duplexDegraded: _duplexDegraded,
        onMicrophoneChanged: (enabled) {
          _emit(_current.fromLiveKitRoom(
            room,
            microphoneEnabled: enabled,
            microphonePausedForPlayback: !enabled,
          ));
        },
      ));
    } else if (remotePlayback &&
        (payload.eventType == 'playback.ended' ||
            payload.eventType == 'playback.interrupted' ||
            payload.eventType == 'playback.failed' ||
            payload.eventType == 'barge_in.confirmed')) {
      unawaited(_ttsCapture.onPlaybackFinished(
        room: room,
        playbackId: payload.playbackId!,
        generation: payload.generation,
        fullDuplexEnabled: _fullDuplexEnabled,
        duplexDegraded: _duplexDegraded,
        onMicrophoneChanged: (enabled) {
          _emit(_current.fromLiveKitRoom(
            room,
            microphoneEnabled: enabled,
            microphonePausedForPlayback: !enabled,
          ));
        },
      ));
    }
    _emit(_current.fromLiveKitRoom(
      room,
      message: payload.message,
      captions: caption == null
          ? null
          : _eventState.mergeCaption(_current.captions, caption),
      conversationState: payload.conversationState,
      playbackState: payload.playbackState,
      activePlaybackId: payload.playbackId,
      pipelineGeneration: payload.pipelineGeneration,
      lastEventType: payload.eventType,
      clearActivePlaybackId:
          payload.playbackState == CallRoomPlaybackState.ended ||
              payload.playbackState == CallRoomPlaybackState.interrupted ||
              payload.playbackState == CallRoomPlaybackState.failed,
    ));
  }

  void _handleAgentDeliveryMessage(
    List<int> data, {
    required String sessionId,
    required String participantIdentity,
  }) {
    if (participantIdentity.isEmpty) return;
    final event = parseAgentDeliveryRoomEvent(
      data,
      expectedSessionId: sessionId,
      expectedClientParticipantIdentity: participantIdentity,
    );
    if (event == null) return;
    final now = DateTime.now().toUtc();
    if (event.occurredAt.isAfter(now.add(const Duration(seconds: 30))) ||
        event.occurredAt.isBefore(now.subtract(const Duration(minutes: 5))) ||
        !_deliveryEventState.accept(event)) {
      return;
    }
    if (!_disposed && !_deliveryEvents.isClosed) {
      _deliveryEvents.add(event);
    }
  }
}
