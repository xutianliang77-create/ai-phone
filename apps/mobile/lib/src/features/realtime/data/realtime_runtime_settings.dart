import '../../../app/app_config.dart';
import '../../../platform/translation/supported_translation_language.dart';

enum RealtimeProcessingMode { onDevice, online }
enum RealtimeVoiceOutputMode { off, natural, myVoice }

class RealtimeRuntimeSettings {
  const RealtimeRuntimeSettings({
    required this.processingMode,
    required this.sourceLanguage,
    required this.targetLanguage,
    required this.voiceOutputMode,
  });

  factory RealtimeRuntimeSettings.fromConfig(AppConfig config) {
    return RealtimeRuntimeSettings(
      processingMode: config.useLocalSessions || config.useDeviceAsr
          ? RealtimeProcessingMode.onDevice
          : RealtimeProcessingMode.online,
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.autoReverseTargetLanguage
          ? autoReverseTargetLanguageCode
          : config.targetLanguage,
      voiceOutputMode: realtimeVoiceOutputModeFromString(
        config.realtimeVoiceOutputMode,
      ),
    );
  }

  factory RealtimeRuntimeSettings.fromJson(Map<String, Object?> json) {
    return RealtimeRuntimeSettings(
      processingMode: json['processingMode'] == 'online'
          ? RealtimeProcessingMode.online
          : RealtimeProcessingMode.onDevice,
      sourceLanguage: normalizeSourceLanguageCode(
        json['sourceLanguage'] as String? ?? autoSourceLanguageCode,
      ),
      targetLanguage: normalizeTargetSettingCode(
        json['targetLanguage'] as String? ?? autoReverseTargetLanguageCode,
      ),
      voiceOutputMode: json['voiceOutputMode'] == null
          ? (json['autoSpeakTranslation'] == true
              ? RealtimeVoiceOutputMode.natural
              : RealtimeVoiceOutputMode.off)
          : realtimeVoiceOutputModeFromString(
              json['voiceOutputMode'] as String? ?? 'off',
            ),
    );
  }

  final RealtimeProcessingMode processingMode;
  final String sourceLanguage;
  final String targetLanguage;
  final RealtimeVoiceOutputMode voiceOutputMode;

  bool get autoSpeakTranslation {
    return voiceOutputMode != RealtimeVoiceOutputMode.off;
  }

  bool get autoReverseTargetLanguage {
    return targetLanguage == autoReverseTargetLanguageCode;
  }

  AppConfig applyTo(AppConfig base) {
    final concreteTarget = autoReverseTargetLanguage
        ? _fallbackAutoReverseTarget(sourceLanguage)
        : normalizeTargetLanguageCode(targetLanguage);
    return base.copyWith(
      sourceLanguage: sourceLanguage,
      targetLanguage: concreteTarget,
      autoReverseTargetLanguage: autoReverseTargetLanguage,
      useDeviceAsr: processingMode == RealtimeProcessingMode.onDevice,
      useLocalSessions: processingMode == RealtimeProcessingMode.onDevice,
      useOnDeviceTranslation: processingMode == RealtimeProcessingMode.onDevice,
      realtimeVoiceOutputMode: realtimeVoiceOutputModeToString(
        voiceOutputMode,
      ),
    );
  }

  RealtimeRuntimeSettings copyWith({
    RealtimeProcessingMode? processingMode,
    String? sourceLanguage,
    String? targetLanguage,
    bool? autoSpeakTranslation,
    RealtimeVoiceOutputMode? voiceOutputMode,
  }) {
    final nextVoiceOutputMode = voiceOutputMode ??
        (autoSpeakTranslation == null
            ? this.voiceOutputMode
            : _toggleVoiceOutputMode(autoSpeakTranslation));
    return RealtimeRuntimeSettings(
      processingMode: processingMode ?? this.processingMode,
      sourceLanguage: sourceLanguage == null
          ? this.sourceLanguage
          : normalizeSourceLanguageCode(sourceLanguage),
      targetLanguage: targetLanguage == null
          ? this.targetLanguage
          : normalizeTargetSettingCode(targetLanguage),
      voiceOutputMode: nextVoiceOutputMode,
    );
  }

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'processingMode': processingMode == RealtimeProcessingMode.online
          ? 'online'
          : 'onDevice',
      'sourceLanguage': sourceLanguage,
      'targetLanguage': targetLanguage,
      'voiceOutputMode': realtimeVoiceOutputModeToString(voiceOutputMode),
      'autoSpeakTranslation': autoSpeakTranslation,
    };
  }

  RealtimeVoiceOutputMode _toggleVoiceOutputMode(bool enabled) {
    if (!enabled) return RealtimeVoiceOutputMode.off;
    return voiceOutputMode == RealtimeVoiceOutputMode.off
        ? RealtimeVoiceOutputMode.natural
        : voiceOutputMode;
  }
}

RealtimeVoiceOutputMode realtimeVoiceOutputModeFromString(String value) {
  switch (value.trim().toLowerCase()) {
    case 'natural':
      return RealtimeVoiceOutputMode.natural;
    case 'my_voice':
      return RealtimeVoiceOutputMode.myVoice;
    default:
      return RealtimeVoiceOutputMode.off;
  }
}

String realtimeVoiceOutputModeToString(RealtimeVoiceOutputMode mode) {
  switch (mode) {
    case RealtimeVoiceOutputMode.off:
      return 'off';
    case RealtimeVoiceOutputMode.natural:
      return 'natural';
    case RealtimeVoiceOutputMode.myVoice:
      return 'my_voice';
  }
}

String normalizeTargetSettingCode(String value) {
  if (value.trim().toLowerCase() == autoReverseTargetLanguageCode) {
    return autoReverseTargetLanguageCode;
  }
  return normalizeTargetLanguageCode(value);
}

String _fallbackAutoReverseTarget(String sourceLanguage) {
  if (sourceLanguage == autoSourceLanguageCode) return 'zh';
  return oppositeTargetLanguageCode(sourceLanguage);
}
