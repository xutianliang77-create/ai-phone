import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const deviceTextLanguageProtocol = 'ai-phone.text-language.v1';
const deviceTextLanguageMethod = 'apple_nl_text_v1';
typedef TextLanguageAnalyzer = Future<Map<String, Object?>> Function(
    String text);
bool get supportsDeviceTextLanguage =>
    !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

Future<Map<String, Object?>> analyzeDeviceTextLanguage(String text) async =>
    Map<String, Object?>.from(
        await const MethodChannel('translation_mobile/text_language')
                .invokeMapMethod<String, Object?>('analyze', {'text': text}) ??
            {});

/// Verify the exact UTF-8 text before calling native code. Return only the
/// challenge binding and local observations, never model/target/account choices.
Future<Map<String, Object?>?> answerTextLanguageChallenge(
    Map<String, Object?> request,
    String sessionId,
    TextLanguageAnalyzer analyze) async {
  const keys = {
    'type',
    'sessionId',
    'requestId',
    'segmentId',
    'revision',
    'textSha256',
    'method',
    'text'
  };
  bool key(Object? v) =>
      v is String && RegExp(r'^[A-Za-z0-9._:-]{1,240}$').hasMatch(v);
  final text = request['text'], revision = request['revision'];
  if (request.keys.toSet().difference(keys).isNotEmpty ||
      request.length != keys.length ||
      request['type'] != 'text.language.request' ||
      request['method'] != deviceTextLanguageMethod ||
      request['sessionId'] != sessionId ||
      !key(request['requestId']) ||
      !key(request['segmentId']) ||
      revision is! int ||
      revision < 1 ||
      text is! String ||
      text.isEmpty ||
      text.length > 16000 ||
      sha256.convert(utf8.encode(text)).toString() != request['textSha256']) {
    return null;
  }
  Map<String, Object?> observation;
  try {
    observation =
        await analyze(text).timeout(const Duration(milliseconds: 1500));
  } catch (_) {
    observation = {};
  }
  final valid = observation['method'] == deviceTextLanguageMethod &&
      observation['evidence'] == 'text_only_not_acoustic' &&
      observation['hypotheses'] is Map;
  return {
    for (final k in [
      'sessionId',
      'requestId',
      'segmentId',
      'revision',
      'textSha256'
    ])
      k: request[k],
    'type': 'text.language.result',
    'method': deviceTextLanguageMethod,
    'evidence': 'text_only_not_acoustic',
    'dominant': valid ? observation['dominant'] : null,
    'hypotheses': valid ? observation['hypotheses'] : <String, double>{},
  };
}
