import 'dart:io';

import 'package:flutter/services.dart';

import 'enterprise_meeting_screen_share_models.dart';

class EnterpriseReplayKitBridge {
  EnterpriseReplayKitBridge({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(_channelName);

  static const _channelName = 'translation_mobile/enterprise_replaykit';
  final MethodChannel _channel;

  Future<bool> isConfigured() async {
    if (!Platform.isIOS) return false;
    return await _channel.invokeMethod<bool>('isConfigured') ?? false;
  }

  Future<void> prepare({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  }) => _write('prepare', share, controlNonce);

  Future<void> renew({
    required EnterpriseMobileScreenShare share,
    required String controlNonce,
  }) => _write('renew', share, controlNonce);

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

  Future<void> _write(
    String method,
    EnterpriseMobileScreenShare share,
    String controlNonce,
  ) async {
    if (!Platform.isIOS || share.leaseExpiresAt == null) {
      throw const EnterpriseReplayKitException('replaykit_not_available');
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

class EnterpriseReplayKitException implements Exception {
  const EnterpriseReplayKitException(this.code);
  final String code;
  @override
  String toString() => code;
}
