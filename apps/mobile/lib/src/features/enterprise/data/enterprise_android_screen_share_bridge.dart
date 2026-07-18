import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'enterprise_meeting_screen_share_models.dart';
import 'enterprise_screen_share_platform.dart';

class EnterpriseAndroidScreenShareBridge
    implements EnterpriseScreenShareBridge {
  EnterpriseAndroidScreenShareBridge({
    MethodChannel? channel,
    EventChannel? events,
  })  : _channel = channel ?? const MethodChannel(_channelName),
        _events = events ?? const EventChannel('$_channelName/events');

  static const _channelName = 'translation_mobile/enterprise_media_projection';
  final MethodChannel _channel;
  final EventChannel _events;
  StreamSubscription<Object?>? _eventSubscription;

  @override
  Future<bool> isConfigured() async {
    if (!Platform.isAndroid) return false;
    try {
      return await _channel.invokeMethod<bool>('isConfigured') ?? false;
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<void> requestAuthorization() async {
    if (!Platform.isAndroid) {
      throw const EnterpriseScreenSharePlatformException(
        'media_projection_not_available',
      );
    }
    await _invoke('requestNotificationPermission');
    final bool granted;
    try {
      granted = await Helper.requestCapturePermission();
    } on PlatformException {
      throw const EnterpriseScreenSharePlatformException(
        'media_projection_permission_denied',
      );
    }
    if (!granted) {
      throw const EnterpriseScreenSharePlatformException(
        'media_projection_permission_denied',
      );
    }
  }

  @override
  Future<void> prepare({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  }) =>
      _write('prepare', share, controlNonce);

  @override
  Future<void> activate({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
    required String captureTrackId,
  }) =>
      _invoke('activate', <String, Object?>{
        ..._control(share, controlNonce),
        'captureTrackId': captureTrackId,
      });

  @override
  Future<void> renew({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  }) =>
      _write('renew', share, controlNonce);

  @override
  Future<void> deactivate() => _invoke('deactivate');

  @override
  Future<void> clear({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  }) =>
      _invoke('clear', <String, Object?>{
        'shareId': share.id,
        'generation': share.generation,
        'controlNonce': controlNonce,
      });

  @override
  void setOnSystemStopped(void Function() callback) {
    unawaited(_eventSubscription?.cancel());
    if (!Platform.isAndroid) return;
    _eventSubscription = _events.receiveBroadcastStream().listen(
          (_) => callback(),
          onError: (_) => callback(),
        );
  }

  @override
  Future<void> dispose() async {
    await _eventSubscription?.cancel();
    _eventSubscription = null;
  }

  Future<void> _write(
    String method,
    EnterpriseMobileScreenShare share,
    String controlNonce,
  ) async {
    if (!Platform.isAndroid || share.leaseExpiresAt == null) {
      throw const EnterpriseScreenSharePlatformException(
        'media_projection_not_available',
      );
    }
    await _invoke(method, _control(share, controlNonce));
  }

  Map<String, Object?> _control(
    EnterpriseMobileScreenShare share,
    String controlNonce,
  ) =>
      <String, Object?>{
        'shareId': share.id,
        'generation': share.generation,
        'publisherIdentity': share.publisherIdentity,
        'leaseExpiresAt': share.leaseExpiresAt!.toUtc().toIso8601String(),
        'controlNonce': controlNonce,
      };

  Future<void> _invoke(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    try {
      await _channel.invokeMethod<void>(method, arguments);
    } on PlatformException catch (error) {
      throw EnterpriseScreenSharePlatformException(error.code);
    }
  }
}
