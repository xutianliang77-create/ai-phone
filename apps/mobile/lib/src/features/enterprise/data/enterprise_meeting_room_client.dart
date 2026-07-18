import 'dart:async';

import 'package:livekit_client/livekit_client.dart' as livekit;

import 'enterprise_meeting_models.dart';

enum EnterpriseMeetingRoomStatus {
  disconnected,
  connecting,
  connected,
  reconnecting,
}

class EnterpriseMeetingRoomSnapshot {
  const EnterpriseMeetingRoomSnapshot({
    required this.status,
    required this.microphoneEnabled,
    required this.remoteParticipantCount,
  });

  const EnterpriseMeetingRoomSnapshot.disconnected()
      : status = EnterpriseMeetingRoomStatus.disconnected,
        microphoneEnabled = false,
        remoteParticipantCount = 0;

  final EnterpriseMeetingRoomStatus status;
  final bool microphoneEnabled;
  final int remoteParticipantCount;
}

class EnterpriseMeetingRoomClient {
  final StreamController<EnterpriseMeetingRoomSnapshot> _snapshots =
      StreamController<EnterpriseMeetingRoomSnapshot>.broadcast();
  livekit.Room? _room;
  livekit.EventsListener<livekit.RoomEvent>? _listener;
  bool _disposed = false;

  Stream<EnterpriseMeetingRoomSnapshot> get snapshots => _snapshots.stream;

  Future<void> connect(EnterpriseMobileMeetingJoinGrant grant) async {
    if (_disposed) return;
    await _disposeRoom();
    _emit(const EnterpriseMeetingRoomSnapshot(
      status: EnterpriseMeetingRoomStatus.connecting,
      microphoneEnabled: false,
      remoteParticipantCount: 0,
    ));
    final room = livekit.Room(
      roomOptions: const livekit.RoomOptions(
        adaptiveStream: true,
        dynacast: true,
      ),
    );
    final listener = room.createListener();
    _room = room;
    _listener = listener;
    _listen(room, listener);
    try {
      await room.prepareConnection(grant.rtcUrl.toString(), grant.accessToken);
      await room.connect(
        grant.rtcUrl.toString(),
        grant.accessToken,
        connectOptions: const livekit.ConnectOptions(autoSubscribe: true),
      );
      await room.localParticipant?.setMicrophoneEnabled(true);
      _emit(_snapshot(room, EnterpriseMeetingRoomStatus.connected));
    } catch (_) {
      await _disposeRoom();
      _emit(const EnterpriseMeetingRoomSnapshot.disconnected());
      rethrow;
    }
  }

  Future<void> setMicrophoneEnabled(bool enabled) async {
    final room = _room;
    if (room == null) return;
    await room.localParticipant?.setMicrophoneEnabled(enabled);
    _emit(_snapshot(room));
  }

  Future<void> disconnect() async {
    await _disposeRoom();
    _emit(const EnterpriseMeetingRoomSnapshot.disconnected());
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _disposeRoom();
    await _snapshots.close();
  }

  void _listen(
    livekit.Room room,
    livekit.EventsListener<livekit.RoomEvent> listener,
  ) {
    listener
      ..on<livekit.RoomConnectedEvent>((_) {
        _emit(_snapshot(room, EnterpriseMeetingRoomStatus.connected));
      })
      ..on<livekit.RoomReconnectingEvent>((_) {
        _emit(_snapshot(room, EnterpriseMeetingRoomStatus.reconnecting));
      })
      ..on<livekit.RoomReconnectedEvent>((_) {
        _emit(_snapshot(room, EnterpriseMeetingRoomStatus.connected));
      })
      ..on<livekit.ParticipantConnectedEvent>((_) => _emit(_snapshot(room)))
      ..on<livekit.ParticipantDisconnectedEvent>((_) => _emit(_snapshot(room)))
      ..on<livekit.RoomDisconnectedEvent>((_) {
        _emit(const EnterpriseMeetingRoomSnapshot.disconnected());
      });
  }

  EnterpriseMeetingRoomSnapshot _snapshot(
    livekit.Room room, [
    EnterpriseMeetingRoomStatus status = EnterpriseMeetingRoomStatus.connected,
  ]) {
    return EnterpriseMeetingRoomSnapshot(
      status: status,
      microphoneEnabled: room.localParticipant?.isMicrophoneEnabled() ?? false,
      remoteParticipantCount: room.remoteParticipants.length,
    );
  }

  Future<void> _disposeRoom() async {
    final listener = _listener;
    final room = _room;
    _listener = null;
    _room = null;
    if (listener != null) await _ignore(listener.dispose);
    if (room != null) {
      await _ignore(room.disconnect);
      await _ignore(room.dispose);
    }
  }

  Future<void> _ignore(Future<dynamic> Function() action) async {
    try {
      await action();
    } catch (_) {}
  }

  void _emit(EnterpriseMeetingRoomSnapshot snapshot) {
    if (!_disposed && !_snapshots.isClosed) _snapshots.add(snapshot);
  }
}
