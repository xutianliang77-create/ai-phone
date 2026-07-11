import 'dart:async';

import 'package:livekit_client/livekit_client.dart' as livekit;

import 'call_link_api_client.dart';
import 'call_room_audio_track_policy.dart';
import 'call_room_data_event.dart';
import 'call_room_client.dart';

class LiveKitCallRoomClient implements CallRoomClient {
  final StreamController<CallRoomSnapshot> _snapshots =
      StreamController<CallRoomSnapshot>.broadcast();

  livekit.Room? _room;
  livekit.EventsListener<livekit.RoomEvent>? _listener;
  CallRoomSnapshot _current = const CallRoomSnapshot.disconnected();
  bool _disposed = false;

  @override
  Stream<CallRoomSnapshot> get snapshots => _snapshots.stream;

  @override
  Future<void> connect(CallRoomToken token) async {
    if (_disposed) return;
    await _disposeRoom(disconnectFirst: true);
    _emit(const CallRoomSnapshot(
      status: CallRoomConnectionStatus.connecting,
      microphoneEnabled: false,
      remoteParticipantCount: 0,
    ));

    final room = livekit.Room(
      roomOptions: const livekit.RoomOptions(
        adaptiveStream: false,
        dynacast: false,
      ),
    );
    final listener = room.createListener();
    _room = room;
    _listener = listener;
    _listenToRoom(room, listener, localRole: token.participantRole);

    try {
      await room.prepareConnection(token.wsUrl, token.token);
      await room.connect(
        token.wsUrl,
        token.token,
        connectOptions: const livekit.ConnectOptions(autoSubscribe: false),
      );
      await room.localParticipant?.setMicrophoneEnabled(true);
      await _syncRemoteAudioSubscriptions(room,
          localRole: token.participantRole);
      _emit(_snapshotFromRoom(
        room,
        status: CallRoomConnectionStatus.connected,
        microphoneEnabled: true,
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
    required String localRole,
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
        _emit(_snapshotFromRoom(
          room,
          status: CallRoomConnectionStatus.connected,
        ));
      })
      ..on<livekit.ParticipantConnectedEvent>((_) {
        _emit(_snapshotFromRoom(room));
      })
      ..on<livekit.ParticipantDisconnectedEvent>((_) {
        _emit(_snapshotFromRoom(room));
      })
      ..on<livekit.TrackPublishedEvent>((event) {
        unawaited(_subscribeRemoteAudioPublication(
          event.publication,
          localRole: localRole,
        ));
      })
      ..on<livekit.TrackSubscribedEvent>((event) {
        unawaited(_ensureSubscribedAudioPublicationAllowed(
          event.publication,
          localRole: localRole,
        ));
      })
      ..on<livekit.DataReceivedEvent>((event) {
        _handleDataMessage(room, event.data);
      })
      ..on<livekit.RoomDisconnectedEvent>((event) {
        _emit(CallRoomSnapshot.disconnected(
          message: event.reason == null ? null : 'LiveKit: ${event.reason}',
        ));
      });
  }

  Future<void> _syncRemoteAudioSubscriptions(
    livekit.Room room, {
    required String localRole,
  }) async {
    for (final participant in room.remoteParticipants.values) {
      for (final publication in participant.audioTrackPublications) {
        await _subscribeRemoteAudioPublication(
          publication,
          localRole: localRole,
        );
      }
    }
  }

  Future<void> _subscribeRemoteAudioPublication(
    livekit.RemoteTrackPublication publication, {
    required String localRole,
  }) async {
    if (publication.kind != livekit.TrackType.AUDIO) return;
    if (!shouldSubscribeCallRoomAudioTrack(
      trackName: publication.name,
      localRole: localRole,
    )) {
      await publication.unsubscribe();
      return;
    }
    await publication.subscribe();
  }

  Future<void> _ensureSubscribedAudioPublicationAllowed(
    livekit.RemoteTrackPublication publication, {
    required String localRole,
  }) async {
    if (publication.kind != livekit.TrackType.AUDIO) return;
    if (!shouldSubscribeCallRoomAudioTrack(
      trackName: publication.name,
      localRole: localRole,
    )) {
      await publication.unsubscribe();
    }
  }

  CallRoomSnapshot _snapshotFromRoom(
    livekit.Room room, {
    CallRoomConnectionStatus? status,
    bool? microphoneEnabled,
    String? message,
    List<CallRoomCaption>? captions,
  }) {
    final participant = room.localParticipant;
    return _current.copyWith(
      status: status ?? _current.status,
      microphoneEnabled:
          microphoneEnabled ?? (participant?.isMicrophoneEnabled() ?? false),
      remoteParticipantCount: room.remoteParticipants.length,
      message: message,
      captions: captions,
    );
  }

  void _handleDataMessage(livekit.Room room, List<int> data) {
    final payload = parseCallRoomData(data);
    final caption = payload.caption;
    _emit(_snapshotFromRoom(
      room,
      message: payload.message,
      captions: caption == null ? null : _mergeCaption(caption),
    ));
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
    final listener = _listener;
    final room = _room;
    _listener = null;
    _room = null;
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
