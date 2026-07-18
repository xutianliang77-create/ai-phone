import 'dart:io';

import 'package:flutter/services.dart';

import 'enterprise_meeting_screen_share_models.dart';
import 'enterprise_screen_share_platform.dart';

class EnterpriseReplayKitBridge implements EnterpriseScreenShareBridge {
  EnterpriseReplayKitBridge({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(_channelName);

  static const _channelName = 'translation_mobile/enterprise_replaykit';
  final MethodChannel _channel;

  @override
  Future<bool> isConfigured() async {
    if (!Platform.isIOS) return false;
    return await _channel.invokeMethod<bool>('isConfigured') ?? false;
  }

  @override
  Future<void> requestAuthorization() async {}

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
  }) async {}

  @override
  Future<void> renew({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  }) =>
      _write('renew', share, controlNonce);

  @override
  Future<void> deactivate() async {}

  @override
  Future<void> clear({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  }) async {
    if (!Platform.isIOS) return;
    await _channel.invokeMethod<void>('clear', <String, Object?>{
      'shareId': share.id,
      'generation': share.generation,
      'controlNonce': controlNonce,
    });
  }

  @override
  void setOnSystemStopped(void Function() callback) {}

  @override
  Future<void> dispose() async {}

  Future<void> _write(
    String method,
    EnterpriseMobileScreenShare share,
    String controlNonce,
  ) async {
    if (!Platform.isIOS || share.leaseExpiresAt == null) {
      throw const EnterpriseScreenSharePlatformException(
        'replaykit_not_available',
      );
    }
    await _channel.invokeMethod<void>(method, <String, Object?>{
      'shareId': share.id,
      'generation': share.generation,
      'publisherIdentity': share.publisherIdentity,
      'leaseExpiresAt': share.leaseExpiresAt!.toUtc().toIso8601String(),
      'controlNonce': controlNonce,
    });
  }
}
