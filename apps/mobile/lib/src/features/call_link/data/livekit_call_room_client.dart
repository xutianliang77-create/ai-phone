import 'dart:async';
import 'package:livekit_client/livekit_client.dart' as livekit;
import 'call_link_api_client.dart';
import 'call_room_audio_track_policy.dart';
import 'call_room_capture_options.dart';
import 'call_room_data_event.dart';
import 'call_room_participant_policy.dart';
import 'call_room_client.dart';
import 'call_room_tts_capture_controller.dart';

class LiveKitCallRoomClient implements CallRoomClient {
  final StreamController<CallRoomSnapshot> _snapshots =
      StreamController<CallRoomSnapshot>.broadcast();
  livekit.Room? _room;
  livekit.EventsListener<livekit.RoomEvent>? _listener;
  final CallRoomTtsCaptureController _ttsCapture =
      CallRoomTtsCaptureController();
  CallRoomSnapshot _current = const CallRoomSnapshot.disconnected();
  bool _disposed = false;
  bool _fullDuplexEnabled = false;
  bool _duplexDegraded = false;
  bool _translationMediaOnly = false;
  int? _latestPipelineGeneration;
  final Map<String, int> _latestPlaybackGenerations = <String, int>{};

  @override
  Stream<CallRoomSnapshot> get snapshots => _snapshots.stream;

  @override
  Future<void> connect(
    CallRoomToken token, {
    bool enableMicrophone = true,
    bool translationMediaOnly = false,
  }) async {
    if (_disposed) return;
    await _disposeRoom(disconnectFirst: true);
    _fullDuplexEnabled = token.fullDuplexEnabled;
    _duplexDegraded = false;
    _translationMediaOnly = translationMediaOnly;
    _latestPipelineGeneration = null;
    _latestPlaybackGenerations.clear();
    _emit(const CallRoomSnapshot(
      status: CallRoomConnectionStatus.connecting,
      microphoneEnabled: false,
      microphonePausedForPlayback: false,
      remoteParticipantCount: 0,
    ));

    final room = livekit.Room(
      roomOptions: const livekit.RoomOptions(
        adaptiveStream: false,
        dynacast: false,
        defaultAudioOutputOptions: livekit.AudioOutputOptions(speakerOn: true),
      ),
    );
    final listener = room.createListener();
    _room = room;
    _listener = listener;
    _listenToRoom(
      room,
      listener,
      callId: token.callId,
      roomName: token.roomName,
      localRole: token.participantRole,
      localParticipantIdentity: token.participantIdentity,
    );

    try {
      await room.prepareConnection(token.wsUrl, token.token);
      await room.connect(
        token.wsUrl,
        token.token,
        connectOptions: const livekit.ConnectOptions(autoSubscribe: false),
      );
      _syncLocalTrackPermissions(
        room,
        callId: token.callId,
      );
      await room.localParticipant?.setMicrophoneEnabled(
        enableMicrophone,
        audioCaptureOptions:
            enableMicrophone ? callRoomAudioCaptureOptions : null,
      );
      await _syncRemoteAudioSubscriptions(room,
          localRole: token.participantRole,
          localParticipantIdentity: token.participantIdentity);
      _emit(_snapshotFromRoom(
        room,
        status: CallRoomConnectionStatus.connected,
        microphoneEnabled: enableMicrophone,
      ));
    } catch (error) {
      await _disposeRoom(disconnectFirst: true);
      _emit(CallRoomSnapshot.disconnected(
        message: 'Connect call room failed: $error',
      ));
      rethrow;
    }
  }

  @override
  Future<void> disconnect() async {
    await _disposeRoom(disconnectFirst: true);
    _emit(const CallRoomSnapshot.disconnected());
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _disposeRoom(disconnectFirst: true);
    await _snapshots.close();
  }

  void _listenToRoom(
    livekit.Room room,
    livekit.EventsListener<livekit.RoomEvent> listener, {
    required String callId,
    required String roomName,
    required String localRole,
    required String localParticipantIdentity,
  }) {
    listener
      ..on<livekit.RoomConnectedEvent>((_) {
        _emit(_snapshotFromRoom(
          room,
          status: CallRoomConnectionStatus.connected,
        ));
      })
      ..on<livekit.RoomReconnectingEvent>((_) {
        _emit(_snapshotFromRoom(
          room,
          status: CallRoomConnectionStatus.reconnecting,
        ));
      })
      ..on<livekit.RoomReconnectedEvent>((_) {
        _syncLocalTrackPermissions(room, callId: callId);
        _emit(_snapshotFromRoom(
          room,
          status: CallRoomConnectionStatus.connected,
        ));
      })
      ..on<livekit.ParticipantConnectedEvent>((_) {
        _syncLocalTrackPermissions(room, callId: callId);
        _emit(_snapshotFromRoom(room));
      })
      ..on<livekit.ParticipantDisconnectedEvent>((_) {
        _syncLocalTrackPermissions(room, callId: callId);
        _emit(_snapshotFromRoom(room));
      })
      ..on<livekit.TrackPublishedEvent>((event) {
        unawaited(_subscribeRemoteAudioPublication(
          event.publication,
          localRole: localRole,
          localParticipantIdentity: localParticipantIdentity,
        ));
      })
      ..on<livekit.TrackSubscribedEvent>((event) {
        unawaited(_ensureSubscribedAudioPublicationAllowed(
          event.publication,
          localRole: localRole,
          localParticipantIdentity: localParticipantIdentity,
        ));
      })
      ..on<livekit.DataReceivedEvent>((event) {
        if (!isTrustedCallRoomDataPacket(
          topic: event.topic,
          senderIdentity: event.participant?.identity,
        )) {
          return;
        }
        _handleDataMessage(
          room,
          event.data,
          callId: callId,
          roomName: roomName,
          localRole: localRole,
        );
      })
      ..on<livekit.RoomDisconnectedEvent>((event) {
        _fullDuplexEnabled = false;
        _duplexDegraded = false;
        _translationMediaOnly = false;
        _emit(CallRoomSnapshot.disconnected(
          message: event.reason == null ? null : 'LiveKit: ${event.reason}',
        ));
      });
  }

  Future<void> _syncRemoteAudioSubscriptions(
    livekit.Room room, {
    required String localRole,
    required String localParticipantIdentity,
  }) async {
    for (final participant in room.remoteParticipants.values) {
      for (final publication in participant.audioTrackPublications) {
        await _subscribeRemoteAudioPublication(
          publication,
          localRole: localRole,
          localParticipantIdentity: localParticipantIdentity,
        );
      }
    }
  }

  void _syncLocalTrackPermissions(
    livekit.Room room, {
    required String callId,
  }) {
    final workerPermissions = room.remoteParticipants.values
        .where((participant) =>
            callRoomParticipantRole(participant.identity) == 'worker' ||
            (_translationMediaOnly &&
                _isTranslationAgentParticipant(participant, callId)))
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

  bool _isTranslationAgentParticipant(
    livekit.RemoteParticipant participant,
    String callId,
  ) {
    if (callRoomParticipantRole(participant.identity) == 'worker') return true;
    if (participant.kind != livekit.ParticipantKind.AGENT) return false;
    final prefix =
        'translation-${callId.substring(0, callId.length < 12 ? callId.length : 12)}-g';
    final generation = participant.identity.startsWith(prefix)
        ? participant.identity.substring(prefix.length)
        : '';
    return generation.isNotEmpty &&
        RegExp(r'^[1-9][0-9]*$').hasMatch(generation);
  }

  Future<void> _subscribeRemoteAudioPublication(
    livekit.RemoteTrackPublication publication, {
    required String localRole,
    required String localParticipantIdentity,
  }) async {
    if (publication.kind != livekit.TrackType.AUDIO) return;
    if (!shouldSubscribeCallRoomAudioTrack(
      trackName: publication.name,
      localRole: localRole,
      localParticipantIdentity: localParticipantIdentity,
      translationMediaOnly: _translationMediaOnly,
    )) {
      await publication.unsubscribe();
      return;
    }
    await publication.subscribe();
  }

  Future<void> _ensureSubscribedAudioPublicationAllowed(
    livekit.RemoteTrackPublication publication, {
    required String localRole,
    required String localParticipantIdentity,
  }) async {
    if (publication.kind != livekit.TrackType.AUDIO) return;
    if (!shouldSubscribeCallRoomAudioTrack(
      trackName: publication.name,
      localRole: localRole,
      localParticipantIdentity: localParticipantIdentity,
      translationMediaOnly: _translationMediaOnly,
    )) {
      await publication.unsubscribe();
    }
  }

  CallRoomSnapshot _snapshotFromRoom(
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
    return _current.copyWith(
      status: status ?? _current.status,
      microphoneEnabled:
          microphoneEnabled ?? (participant?.isMicrophoneEnabled() ?? false),
      microphonePausedForPlayback: microphonePausedForPlayback,
      remoteParticipantCount: room.remoteParticipants.values
          .where(
              (participant) => isHumanCallRoomParticipant(participant.identity))
          .length,
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
    if (!_acceptPipelineGeneration(payload.pipelineGeneration)) return;
    if (!_acceptPlaybackGeneration(payload.playbackId, payload.generation)) {
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
          _emit(_snapshotFromRoom(
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
          _emit(_snapshotFromRoom(
            room,
            microphoneEnabled: enabled,
            microphonePausedForPlayback: !enabled,
          ));
        },
      ));
    }
    _emit(_snapshotFromRoom(
      room,
      message: payload.message,
      captions: caption == null ? null : _mergeCaption(caption),
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

  bool _acceptPipelineGeneration(int? generation) {
    if (generation == null) return true;
    final latest = _latestPipelineGeneration;
    if (latest != null && generation < latest) return false;
    if (latest == null || generation > latest) {
      _latestPipelineGeneration = generation;
    }
    return true;
  }

  bool _acceptPlaybackGeneration(String? playbackId, int? generation) {
    if (playbackId == null || generation == null) return true;
    final latest = _latestPlaybackGenerations[playbackId];
    if (latest != null && generation < latest) return false;
    if (latest == null || generation > latest) {
      _latestPlaybackGenerations[playbackId] = generation;
    }
    return true;
  }

  List<CallRoomCaption> _mergeCaption(CallRoomCaption caption) {
    final captions = List<CallRoomCaption>.of(_current.captions);
    final index =
        captions.indexWhere((item) => item.segmentId == caption.segmentId);
    if (index == -1) {
      captions.add(caption);
    } else {
      captions[index] = captions[index].merge(caption);
    }
    final start = captions.length > 50 ? captions.length - 50 : 0;
    return List<CallRoomCaption>.unmodifiable(captions.sublist(start));
  }

  Future<void> _disposeRoom({required bool disconnectFirst}) async {
    _ttsCapture.reset();
    final listener = _listener;
    final room = _room;
    _listener = null;
    _room = null;
    _fullDuplexEnabled = false;
    _duplexDegraded = false;
    _translationMediaOnly = false;
    _latestPipelineGeneration = null;
    _latestPlaybackGenerations.clear();
    if (listener != null) {
      await _ignoreErrors(listener.dispose);
    }
    if (room != null) {
      if (disconnectFirst) {
        await _ignoreErrors(room.disconnect);
      }
      await _ignoreErrors(room.dispose);
    }
  }

  Future<void> _ignoreErrors(Future<dynamic> Function() action) async {
    try {
      await action();
    } catch (_) {}
  }

  void _emit(CallRoomSnapshot snapshot) {
    _current = snapshot;
    if (!_disposed && !_snapshots.isClosed) {
      _snapshots.add(snapshot);
    }
  }
}
