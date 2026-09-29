import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const deviceTextLanguageProtocol = 'ai-phone.text-language.v1';
const deviceTextLanguageMethod = 'apple_nl_text_v1';
const deviceSpeechEvidenceProtocol = 'ai-phone.speech-evidence.v1';
typedef TextLanguageAnalyzer = Future<Map<String, Object?>> Function(
    String text);
typedef DeviceSpeechObserver = Future<Map<String, Object?>?> Function(
    String sessionId, Map<String, Object?> range);
const deviceSpeechEvidenceMethod = 'ios_silero_render_v1';

bool isDeviceSpeechAudioRange(Object? value) {
  if (value is! Map ||
      value.length != 3 ||
      !value.keys
          .toSet()
          .containsAll({'startSample', 'endSample', 'sampleRate'})) {
    return false;
  }
  final start = value['startSample'],
      end = value['endSample'],
      rate = value['sampleRate'];
  return start is int &&
      end is int &&
      rate is int &&
      [16000, 24000].contains(rate) &&
      start >= 0 &&
      end > start &&
      end <= 9007199254740991 &&
      end - start <= rate * 60;
}

Future<Map<String, Object?>?> observeDeviceSpeech(
        String sessionId, Map<String, Object?> range) =>
    const MethodChannel('translation_mobile/text_language')
        .invokeMapMethod<String, Object?>(
            'audioEvidence', {'sessionId': sessionId, 'audioRange': range});

bool validDeviceSpeechEvidence(
    Map<String, Object?>? value, Map<String, Object?> range) {
  if (value == null ||
      value.length != 5 ||
      value['method'] != deviceSpeechEvidenceMethod ||
      !isDeviceSpeechAudioRange(value['range']) ||
      !['speech', 'non_speech', 'unknown'].contains(value['decision']) ||
      ![
        'speech_overlap',
        'no_speech_support',
        'render_echo',
        'unavailable',
        'uncovered',
        'stale'
      ].contains(value['reason'])) return false;
  final echoed = value['range']! as Map,
      covered = value['coveredThroughSample'];
  if (range.keys.any((k) => range[k] != echoed[k]) ||
      covered is! int ||
      covered < 0) return false;
  if (value['decision'] == 'speech' && value['reason'] != 'speech_overlap') {
    return false;
  }
  return value['decision'] != 'non_speech' ||
      covered >= (range['endSample']! as int) &&
          ['no_speech_support', 'render_echo'].contains(value['reason']);
}

Future<Map<String, Object?>?> _boundedSpeechEvidence(
    DeviceSpeechObserver observe,
    String sessionId,
    Map<String, Object?> range) async {
  try {
    return await observe(sessionId, range)
        .timeout(const Duration(milliseconds: 1500));
  } catch (_) {
    return null;
  }
}

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
    TextLanguageAnalyzer analyze,
    {DeviceSpeechObserver speechObserve = observeDeviceSpeech}) async {
  const keys = {
    'type',
    'sessionId',
    'requestId',
    'segmentId',
    'revision',
    'textSha256',
    'method',
    'text',
    'audioRange'
  };
  bool key(Object? v) =>
      v is String && RegExp(r'^[A-Za-z0-9._:-]{1,240}$').hasMatch(v);
  final text = request['text'], revision = request['revision'];
  if (request.keys.toSet().difference(keys).isNotEmpty ||
      request.length !=
          keys.length - 1 + (request.containsKey('audioRange') ? 1 : 0) ||
      request.containsKey('audioRange') &&
          !isDeviceSpeechAudioRange(request['audioRange']) ||
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
  final range = request['audioRange'] is Map
      ? Map<String, Object?>.from(request['audioRange']! as Map)
      : null;
  // Run in parallel with text LID under its existing deadline, not behind it.
  final audioWork = range == null
      ? null
      : _boundedSpeechEvidence(speechObserve, sessionId, range);
  try {
    observation =
        await analyze(text).timeout(const Duration(milliseconds: 1500));
  } catch (_) {
    observation = {};
  }
  final valid = observation['method'] == deviceTextLanguageMethod &&
      observation['evidence'] == 'text_only_not_acoustic' &&
      observation['hypotheses'] is Map;
  final audioEvidence = audioWork == null ? null : await audioWork;
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
    if (range != null && validDeviceSpeechEvidence(audioEvidence, range))
      'audioEvidence': audioEvidence,
  };
}
