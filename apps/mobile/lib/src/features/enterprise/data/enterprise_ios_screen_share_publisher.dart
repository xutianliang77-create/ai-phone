import 'dart:async';
import 'dart:io';

import 'package:livekit_client/livekit_client.dart' as livekit;
// livekit_client 2.8.1 does not export BroadcastManager publicly. This pinned
// implementation API is required to keep the audio room from auto-publishing.
// ignore: implementation_imports
import 'package:livekit_client/src/managers/broadcast_manager.dart'
    as livekit_broadcast;

import 'enterprise_meeting_screen_share_models.dart';
import 'enterprise_screen_share_platform.dart';

class EnterpriseIosScreenSharePublisher
    implements EnterpriseScreenSharePublisher {
  livekit.Room? _room;
  livekit.EventsListener<livekit.RoomEvent>? _listener;
  EnterpriseScreenSharePublished? _onPublished;
  void Function()? _onEnded;
  String? _publishedSid;
  bool _broadcastObserved = false;
  bool _publishing = false;
  bool _closing = false;

  @override
  bool get isSupported => Platform.isIOS;

  @override
  Future<void> start({
    required EnterpriseMobileScreenShareGrant grant,
    required String qualityMode,
    required EnterpriseScreenSharePublished onPublished,
    required void Function() onEnded,
    required bool Function() isCancelled,
  }) async {
    if (!isSupported) throw UnsupportedError('ios_replaykit_required');
    await stop(requestSystemStop: false);
    _ensureActive(isCancelled);
    _closing = false;
    _onPublished = onPublished;
    _onEnded = onEnded;
    final captureOptions = _captureOptions(qualityMode);
    final room = livekit.Room(
      roomOptions: livekit.RoomOptions(
        adaptiveStream: true,
        dynacast: true,
        defaultScreenShareCaptureOptions: captureOptions,
        defaultVideoPublishOptions:
            enterpriseScreenShareVideoPublishOptions(qualityMode),
      ),
    );
    final listener = room.createListener();
    _room = room;
    _listener = listener;
    listener
      ..on<livekit.LocalTrackPublishedEvent>((event) {
        if (event.publication.source != livekit.TrackSource.screenShareVideo ||
            _closing ||
            _publishedSid == event.publication.sid) {
          return;
        }
        _notifyPublished(event.publication);
      })
      ..on<livekit.LocalTrackUnpublishedEvent>((event) {
        if (event.publication.source == livekit.TrackSource.screenShareVideo) {
          _notifyEnded();
        }
      })
      ..on<livekit.RoomDisconnectedEvent>((_) => _notifyEnded());
    final broadcast = livekit_broadcast.BroadcastManager();
    broadcast.shouldPublishTrack = false;
    broadcast.addListener(_broadcastChanged);
    try {
      await room.prepareConnection(grant.rtcUrl.toString(), grant.accessToken);
      _ensureActive(isCancelled, room);
      await room.connect(
        grant.rtcUrl.toString(),
        grant.accessToken,
        connectOptions: const livekit.ConnectOptions(autoSubscribe: false),
      );
      _ensureActive(isCancelled, room);
      if (broadcast.isBroadcasting) {
        _broadcastChanged();
      } else {
        await broadcast.requestActivation();
      }
    } catch (_) {
      await stop(requestSystemStop: false);
      rethrow;
    }
  }

  @override
  Future<void> stop({bool requestSystemStop = true}) async {
    _closing = true;
    final broadcast = livekit_broadcast.BroadcastManager();
    broadcast.removeListener(_broadcastChanged);
    broadcast.shouldPublishTrack = false;
    if (requestSystemStop && broadcast.isBroadcasting) {
      await _ignore(broadcast.requestStop);
    }
    final room = _room;
    final listener = _listener;
    _room = null;
    _listener = null;
    if (room != null) {
      final participant = room.localParticipant;
      if (participant != null) {
        await _ignore(() => participant.setScreenShareEnabled(false));
      }
    }
    if (listener != null) await _ignore(listener.dispose);
    if (room != null) {
      await _ignore(room.disconnect);
      await _ignore(room.dispose);
    }
    _publishedSid = null;
    _broadcastObserved = false;
    _publishing = false;
    _onPublished = null;
    _onEnded = null;
    broadcast.shouldPublishTrack = true;
  }

  void _broadcastChanged() {
    final broadcasting = livekit_broadcast.BroadcastManager().isBroadcasting;
    if (broadcasting) {
      _broadcastObserved = true;
      unawaited(_publish());
    } else if (_broadcastObserved) {
      _notifyEnded();
    }
  }

  Future<void> _publish() async {
    final participant = _room?.localParticipant;
    if (_publishing || _closing || participant == null) return;
    _publishing = true;
    try {
      final publication = await participant.setScreenShareEnabled(
        true,
        captureScreenAudio: false,
        screenShareCaptureOptions:
            _room!.roomOptions.defaultScreenShareCaptureOptions,
      );
      if (publication != null) _notifyPublished(publication);
    } catch (_) {
      _notifyEnded();
    } finally {
      _publishing = false;
    }
  }

  void _notifyPublished(livekit.LocalTrackPublication publication) {
    final trackSid = publication.sid;
    final captureTrackId = publication.track?.mediaStreamTrack.id;
    if (_closing ||
        trackSid.isEmpty ||
        captureTrackId == null ||
        captureTrackId.isEmpty ||
        _publishedSid == trackSid) {
      return;
    }
    _publishedSid = trackSid;
    _onPublished?.call(trackSid, captureTrackId);
  }

  void _notifyEnded() {
    if (_closing) return;
    _closing = true;
    _onEnded?.call();
  }

  void _ensureActive(
    bool Function() isCancelled, [
    livekit.Room? expectedRoom,
  ]) {
    if (isCancelled() ||
        _closing ||
        expectedRoom != null && !identical(_room, expectedRoom)) {
      throw StateError('screen_share_start_cancelled');
    }
  }

  livekit.ScreenShareCaptureOptions _captureOptions(String qualityMode) {
    final parameters = enterpriseScreenShareVideoParameters(qualityMode);
    return livekit.ScreenShareCaptureOptions(
      useiOSBroadcastExtension: true,
      captureScreenAudio: false,
      maxFrameRate: (parameters.encoding?.maxFramerate ?? 15).toDouble(),
      params: parameters,
    );
  }

  Future<void> _ignore(Future<dynamic> Function() action) async {
    try {
      await action();
    } catch (_) {}
  }
}
