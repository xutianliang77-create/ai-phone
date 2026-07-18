import 'dart:async';
import 'dart:io';

import 'package:livekit_client/livekit_client.dart' as livekit;

import 'enterprise_meeting_screen_share_models.dart';
import 'enterprise_screen_share_platform.dart';

class EnterpriseAndroidScreenSharePublisher
    implements EnterpriseScreenSharePublisher {
  livekit.Room? _room;
  livekit.EventsListener<livekit.RoomEvent>? _listener;
  void Function()? _onEnded;
  bool _closing = false;

  @override
  bool get isSupported => Platform.isAndroid;

  @override
  Future<void> start({
    required EnterpriseMobileScreenShareGrant grant,
    required String qualityMode,
    required EnterpriseScreenSharePublished onPublished,
    required void Function() onEnded,
    required bool Function() isCancelled,
  }) async {
    if (!isSupported) {
      throw const EnterpriseScreenSharePlatformException(
        'media_projection_not_available',
      );
    }
    await stop(requestSystemStop: false);
    _ensureActive(isCancelled);
    _closing = false;
    _onEnded = onEnded;
    final captureOptions = _captureOptions(qualityMode);
    final room = livekit.Room(
      roomOptions: livekit.RoomOptions(
        adaptiveStream: true,
        dynacast: true,
        defaultScreenShareCaptureOptions: captureOptions,
      ),
    );
    final listener = room.createListener();
    _room = room;
    _listener = listener;
    listener
      ..on<livekit.LocalTrackUnpublishedEvent>((event) {
        if (event.publication.source == livekit.TrackSource.screenShareVideo) {
          _notifyEnded();
        }
      })
      ..on<livekit.RoomDisconnectedEvent>((_) => _notifyEnded());
    try {
      await room.prepareConnection(grant.rtcUrl.toString(), grant.accessToken);
      _ensureActive(isCancelled, room);
      await room.connect(
        grant.rtcUrl.toString(),
        grant.accessToken,
        connectOptions: const livekit.ConnectOptions(autoSubscribe: false),
      );
      _ensureActive(isCancelled, room);
      final participant = room.localParticipant;
      if (participant == null) {
        throw const EnterpriseScreenSharePlatformException(
          'media_projection_room_not_ready',
        );
      }
      final publication = await participant.setScreenShareEnabled(
        true,
        captureScreenAudio: false,
        screenShareCaptureOptions: captureOptions,
      );
      _ensureActive(isCancelled, room);
      final trackSid = publication?.sid;
      final captureTrackId = publication?.track?.mediaStreamTrack.id;
      if (trackSid == null ||
          trackSid.isEmpty ||
          captureTrackId == null ||
          captureTrackId.isEmpty) {
        throw const EnterpriseScreenSharePlatformException(
          'media_projection_track_not_ready',
        );
      }
      onPublished(trackSid, captureTrackId);
    } catch (_) {
      await stop(requestSystemStop: false);
      rethrow;
    }
  }

  @override
  Future<void> stop({bool requestSystemStop = true}) async {
    _closing = true;
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
    _onEnded = null;
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
      throw const EnterpriseScreenSharePlatformException(
        'screen_share_start_cancelled',
      );
    }
  }

  livekit.ScreenShareCaptureOptions _captureOptions(String qualityMode) {
    final parameters = switch (qualityMode) {
      'smooth' => livekit.VideoParametersPresets.screenShareH720FPS15,
      'high' => livekit.VideoParametersPresets.screenShareH1440FPS30,
      _ => livekit.VideoParametersPresets.screenShareH1080FPS15,
    };
    return livekit.ScreenShareCaptureOptions(
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
