import 'dart:async';
import 'dart:convert';

import 'package:livekit_client/livekit_client.dart' as livekit;

import 'enterprise_meeting_models.dart';
import 'enterprise_meeting_screen_ocr_models.dart';

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
    required this.screenOcrLayout,
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
        screenShareTrack = null,
        screenOcrLayout = null;

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
  final EnterpriseMobileScreenOcrLayout? screenOcrLayout;
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
  String? _expectedScreenShareId;
  int? _expectedScreenShareGeneration;
  EnterpriseMobileScreenOcrLayout? _screenOcrLayout;
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
      screenOcrLayout: null,
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

  void setExpectedScreenShare({
    required String? publisherIdentity,
    required String? shareId,
    required int? shareGeneration,
  }) {
    final changed = _expectedScreenShareId != shareId ||
        _expectedScreenShareGeneration != shareGeneration;
    _expectedScreenSharePublisherIdentity = publisherIdentity;
    _expectedScreenShareId = shareId;
    _expectedScreenShareGeneration = shareGeneration;
    if (changed) _screenOcrLayout = null;
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
        _handleData(room, event.data, event.topic);
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
      screenOcrLayout: _screenOcrLayout,
    );
  }

  void _handleData(livekit.Room room, List<int> data, String? topic) {
    if (topic == 'wujie.enterprise.meeting.screen_ocr.v1') {
      _handleScreenOcr(room, data);
      return;
    }
    _handleCaption(room, data, topic);
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

  void _handleScreenOcr(livekit.Room room, List<int> data) {
    final grant = _grant;
    final shareId = _expectedScreenShareId;
    final generation = _expectedScreenShareGeneration;
    if (grant == null ||
        shareId == null ||
        generation == null ||
        data.length > 12000) {
      return;
    }
    try {
      final decoded = jsonDecode(utf8.decode(data));
      if (decoded is! Map<String, Object?> ||
          decoded['v'] != 1 ||
          decoded['type'] != 'screen_ocr.layout' ||
          decoded['meetingId'] != grant.meetingId ||
          decoded['targetParticipantId'] != grant.participantId ||
          DateTime.tryParse(decoded['occurredAt'] as String? ?? '') == null ||
          !_validRoomEventUuid(decoded['eventId']) ||
          _seenEventIds.contains(decoded['eventId']) ||
          decoded['layout'] is! Map<String, Object?>) {
        return;
      }
      final layout = EnterpriseMobileScreenOcrLayout.fromJson(
        decoded['layout']! as Map<String, Object?>,
      );
      if (layout.shareId != shareId || layout.shareGeneration != generation) {
        return;
      }
      final current = _screenOcrLayout;
      if (current != null &&
          current.runId == layout.runId &&
          current.frameRevision >= layout.frameRevision) {
        return;
      }
      _seenEventIds.add(decoded['eventId']! as String);
      if (_seenEventIds.length > 200) _seenEventIds.remove(_seenEventIds.first);
      _screenOcrLayout = layout;
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
    _expectedScreenShareId = null;
    _expectedScreenShareGeneration = null;
    _screenOcrLayout = null;
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

bool _validRoomEventUuid(Object? value) =>
    value is String &&
    RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      caseSensitive: false,
    ).hasMatch(value);
