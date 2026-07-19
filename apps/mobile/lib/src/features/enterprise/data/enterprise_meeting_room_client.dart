import 'dart:async';
import 'dart:convert';

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
    required this.translationStatus,
    required this.translationReasonCode,
    required this.captionLanguage,
    required this.translatedAudioEnabled,
    required this.translatedAudioAvailable,
    required this.captions,
    required this.screenShareTrack,
  });

  const EnterpriseMeetingRoomSnapshot.disconnected()
      : status = EnterpriseMeetingRoomStatus.disconnected,
        microphoneEnabled = false,
        remoteParticipantCount = 0,
        translationStatus = 'not_ready',
        translationReasonCode = 'not_joined',
        captionLanguage = 'zh',
        translatedAudioEnabled = false,
        translatedAudioAvailable = false,
        captions = const <EnterpriseMobileMeetingCaption>[],
        screenShareTrack = null;

  final EnterpriseMeetingRoomStatus status;
  final bool microphoneEnabled;
  final int remoteParticipantCount;
  final String translationStatus;
  final String translationReasonCode;
  final String captionLanguage;
  final bool translatedAudioEnabled;
  final bool translatedAudioAvailable;
  final List<EnterpriseMobileMeetingCaption> captions;
  final livekit.RemoteVideoTrack? screenShareTrack;
}

class EnterpriseMeetingRoomClient {
  final StreamController<EnterpriseMeetingRoomSnapshot> _snapshots =
      StreamController<EnterpriseMeetingRoomSnapshot>.broadcast();
  livekit.Room? _room;
  livekit.EventsListener<livekit.RoomEvent>? _listener;
  EnterpriseMobileMeetingJoinGrant? _grant;
  List<EnterpriseMobileMeetingCaption> _captions = const [];
  final Set<String> _seenEventIds = <String>{};
  String? _expectedScreenSharePublisherIdentity;
  bool _disposed = false;

  Stream<EnterpriseMeetingRoomSnapshot> get snapshots => _snapshots.stream;

  Future<void> connect(EnterpriseMobileMeetingJoinGrant grant) async {
    if (_disposed) return;
    await _disposeRoom();
    _grant = grant;
    _captions = const [];
    _seenEventIds.clear();
    _emit(EnterpriseMeetingRoomSnapshot(
      status: EnterpriseMeetingRoomStatus.connecting,
      microphoneEnabled: false,
      remoteParticipantCount: 0,
      translationStatus: grant.translation.status,
      translationReasonCode: grant.translation.reasonCode,
      captionLanguage: grant.translation.captionLanguage,
      translatedAudioEnabled: grant.translation.translatedAudioEnabled,
      translatedAudioAvailable: grant.translation.translatedAudioAvailable,
      captions: const [],
      screenShareTrack: null,
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

  void setExpectedScreenSharePublisherIdentity(String? identity) {
    _expectedScreenSharePublisherIdentity = identity;
    final room = _room;
    if (room != null) _emit(_snapshot(room));
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
      ..on<livekit.TrackSubscribedEvent>((_) => _emit(_snapshot(room)))
      ..on<livekit.TrackUnsubscribedEvent>((_) => _emit(_snapshot(room)))
      ..on<livekit.DataReceivedEvent>((event) {
        if (event.participant != null) return;
        _handleCaption(room, event.data, event.topic);
      })
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
      remoteParticipantCount: room.remoteParticipants.values
          .where(
              (participant) => !participant.identity.startsWith('ent-share:'))
          .length,
      translationStatus: _grant?.translation.status ?? 'not_ready',
      translationReasonCode: _grant?.translation.reasonCode ?? 'not_joined',
      captionLanguage: _grant?.translation.captionLanguage ?? 'zh',
      translatedAudioEnabled:
          _grant?.translation.translatedAudioEnabled ?? false,
      translatedAudioAvailable:
          _grant?.translation.translatedAudioAvailable ?? false,
      captions: List<EnterpriseMobileMeetingCaption>.unmodifiable(_captions),
      screenShareTrack: _screenShareTrack(room),
    );
  }

  void _handleCaption(livekit.Room room, List<int> data, String? topic) {
    final grant = _grant;
    if (grant == null ||
        topic != grant.translation.topic ||
        data.length > 12000) {
      return;
    }
    try {
      final decoded = jsonDecode(utf8.decode(data));
      if (decoded is! Map<String, Object?>) return;
      final caption = EnterpriseMobileMeetingCaption.fromJson(decoded, grant);
      if (!_seenEventIds.add(caption.eventId)) return;
      if (_seenEventIds.length > 200) _seenEventIds.remove(_seenEventIds.first);
      _captions = <EnterpriseMobileMeetingCaption>[
        ..._captions,
        caption,
      ]
          .reversed
          .take(50)
          .toList(growable: false)
          .reversed
          .toList(growable: false);
      _emit(_snapshot(room));
    } catch (_) {
      // Malformed, stale, cross-target, or participant-sent packets are ignored.
    }
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
    _grant = null;
    _expectedScreenSharePublisherIdentity = null;
    _captions = const [];
    _seenEventIds.clear();
  }

  Future<void> _ignore(Future<dynamic> Function() action) async {
    try {
      await action();
    } catch (_) {}
  }

  void _emit(EnterpriseMeetingRoomSnapshot snapshot) {
    if (!_disposed && !_snapshots.isClosed) _snapshots.add(snapshot);
  }

  livekit.RemoteVideoTrack? _screenShareTrack(livekit.Room room) {
    final expected = _expectedScreenSharePublisherIdentity;
    final participant =
        expected == null ? null : room.remoteParticipants[expected];
    if (participant == null) return null;
    for (final publication in participant.videoTrackPublications) {
      if (publication.source == livekit.TrackSource.screenShareVideo &&
          publication.track != null) {
        return publication.track;
      }
    }
    return null;
  }
}
