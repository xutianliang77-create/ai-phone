import 'package:flutter/services.dart';

String? _voiceTag(String raw) {
  final value = raw.trim().replaceAll('_', '-').toLowerCase();
  return RegExp(r'^[a-z]{2,3}(-[a-z0-9]{2,8})*$').hasMatch(value) &&
          !const ['auto', 'und', 'mul', 'zxx'].contains(value.split('-').first)
      ? value
      : null;
}

String? _voiceFamily(String raw) {
  final value = _voiceTag(raw);
  if (value == null) return null;
  final parts = value.split('-');
  if (const ['zh', 'cmn'].contains(parts.first)) {
    for (final region in ['hk', 'mo']) {
      if (parts.contains(region)) return '${parts.first}-$region';
    }
    if (parts.contains('hant')) return 'zh-hant';
    if (parts.contains('hans')) return 'zh';
    return parts.contains('tw') ? 'zh-hant' : 'zh';
  }
  return parts.first;
}

bool speechVoiceLanguageMatches(String actual, String requested) {
  final expected = _voiceTag(requested), observed = _voiceTag(actual);
  if (expected == null ||
      observed == null ||
      _voiceFamily(expected) != _voiceFamily(observed)) {
    return false;
  }
  final actualParts = observed.split('-').skip(1);
  for (final part in expected.split('-').skip(1)) {
    if ((part.length == 2 || RegExp(r'^\d{3}$').hasMatch(part)) &&
        !actualParts.contains(part)) {
      return false;
    }
    if (part.length == 4 &&
        !const ['hans', 'hant'].contains(part) &&
        !actualParts.contains(part)) {
      return false;
    }
  }
  return true;
}

class SystemSpeechVoice {
  const SystemSpeechVoice(
      {required this.identifier,
      required this.name,
      required this.language,
      required this.quality});
  final String identifier, name, language;
  final int quality;

  static SystemSpeechVoice? fromPayload(
      Map<String, Object?> data, String requested) {
    final id = data['voiceIdentifier'],
        name = data['voiceName'],
        language = data['voiceLanguage'];
    final quality = data['voiceQuality'];
    if (data['protocolVersion'] != 1 ||
        data['provider'] != 'ios_system_tts' ||
        data['language'] is! String ||
        _voiceTag(data['language'] as String) != _voiceTag(requested) ||
        data['availableOnDevice'] != true ||
        data['voicePolicy'] != 'apple_system_standard_v1' ||
        id is! String ||
        !const [
          'com.apple.voice.',
          'com.apple.ttsbundle.',
          'com.apple.speech.synthesis.voice.'
        ].any(id.startsWith) ||
        name is! String ||
        name.isEmpty ||
        language is! String ||
        quality is! int ||
        quality < 1 ||
        quality > 3 ||
        !speechVoiceLanguageMatches(language, requested)) {
      return null;
    }
    return SystemSpeechVoice(
        identifier: id, name: name, language: language, quality: quality);
  }
}

class SpeechVoiceAvailability {
  const SpeechVoiceAvailability(
      {required this.canSpeak, required this.reason, this.voice});
  final bool canSpeak;
  final String reason;
  final SystemSpeechVoice? voice;
  // No SDK catalog flag is promoted to a device-offline listening result.
  bool get offlineVerified => false;
  bool get qualityQualified => false;
  void requireReady() {
    if (!canSpeak || voice == null) {
      throw PlatformException(
          code: reason,
          message:
              'The requested system voice is not ready. Check installed voices.');
    }
  }
}

abstract class SpeechOutputDiagnostics {
  Future<SpeechVoiceAvailability> availability(String language);
}
