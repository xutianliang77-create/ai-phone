import '../platform/translation/supported_translation_language.dart';
import '../features/realtime/data/voice_preset_catalog.dart';

String normalizeConfigVoicePresetId(String value) {
  final cleaned = value.trim();
  return RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(cleaned)
      ? cleaned
      : defaultRealtimeVoicePresetId;
}

String normalizeConfigRealtimeVoiceOutputMode(String value) {
  final mode = value.trim().toLowerCase();
  if (mode == 'natural' || mode == 'my_voice') return mode;
  return 'off';
}

String normalizeConfigSourceLanguage(String value) {
  return normalizeSourceLanguageCode(value);
}

String normalizeConfigTargetLanguage(String value) {
  return normalizeTargetLanguageCode(value);
}

String normalizeConfigRealtimeMode(String value) {
  final mode = value.trim().toLowerCase();
  if (mode == 'meeting' || mode == 'classroom' || mode == 'business') {
    return mode;
  }
  return 'conversation';
}
