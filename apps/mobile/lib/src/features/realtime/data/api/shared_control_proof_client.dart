import 'dart:convert';
import 'package:flutter/services.dart';

/// Reuses authentication primitives only, never speech or inference channels.
class SharedControlProofClient {
  SharedControlProofClient({required this.ownerId, MethodChannel? channel})
    : channel =
          channel ??
          const MethodChannel('translation_mobile/v10_shared_control');
  final String ownerId;
  final MethodChannel channel;
  Future<Map<String, Object?>> call(
    String method,
    Map<String, Object?> body,
  ) async {
    final result = await channel.invokeMapMethod<String, Object?>(method, {
      'ownerId': ownerId,
      ...body,
    });
    if (result == null) {
      throw const FormatException('control_device_proof_missing');
    }
    return result;
  }

  Future<Map<String, Object?>> identity() => call('identity', {});
  Future<Map<String, Object?>> register(Map<String, Object?> challenge) =>
      call('registerProof', {
        'clientData': challenge['clientData'],
        'registered': challenge['registered'],
        'appAttestKeyId': challenge['appAttestKeyId'],
      });
  Future<Map<String, Object?>> signIssue(Map<String, Object?> body) async {
    final encoded = base64Encode(utf8.encode(jsonEncode(body)));
    return {
      'clientData': encoded,
      ...await call('signIssue', {'clientData': encoded}),
    };
  }

  Future<String> connection(String data, String sessionId) async {
    final result = await call('connectionProof', {
      'clientData': data,
      'sessionId': sessionId,
    });
    final signature = result['deviceSignature'];
    if (signature is! String || base64Decode(signature).length != 64) {
      throw const FormatException('control_device_signature');
    }
    return signature;
  }
}
