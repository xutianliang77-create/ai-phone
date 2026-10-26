import 'package:flutter/services.dart';

/// Identity credentials stay in memory and are sent only to the scoped account API.
class AppleIdentityClient {
  const AppleIdentityClient({MethodChannel? channel})
    : _channel =
          channel ?? const MethodChannel('translation_mobile/apple_account');
  final MethodChannel _channel;
  Future<Map<String, Object?>> signIn({
    required String nonce,
    required String state,
    required String bundleId,
  }) async {
    final raw = await _channel.invokeMapMethod<String, Object?>('signIn', {
      'nonce': nonce,
      'state': state,
      'bundleId': bundleId,
    });
    if (raw == null ||
        raw['state'] != state ||
        [
          'identityToken',
          'authorizationCode',
        ].any((k) => raw[k] is! String || (raw[k] as String).isEmpty)) {
      throw const FormatException('Apple identity response mismatch');
    }
    return raw;
  }
}
