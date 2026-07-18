import '../../../app/app_config.dart';
import '../../../platform/translation/supported_translation_language.dart';
import 'voice_preset_catalog.dart';
import 'domain_lexicon_pack.dart';

export '../../../platform/translation/supported_translation_language.dart'
    show onDeviceTranslationLanguageCodes;

enum RealtimeProcessingMode { onDevice, online }

enum RealtimeVoiceOutputMode { off, natural, myVoice }

bool realtimeModeSupportsVoiceOutput(String realtimeMode) {
  return realtimeMode == 'conversation';
}

AppConfig applyRealtimeModeVoicePolicy(AppConfig config) {
  if (realtimeModeSupportsVoiceOutput(config.realtimeMode)) return config;
  return config.copyWith(realtimeVoiceOutputMode: 'off');
}

class RealtimeRuntimeSettings {
  const RealtimeRuntimeSettings({
    required this.processingMode,
    required this.sourceLanguage,
    required this.targetLanguage,
    required this.voiceOutputMode,
    this.voicePresetId = defaultRealtimeVoicePresetId,
    this.domainLexiconPack = defaultDomainLexiconPack,
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
      voicePresetId: config.realtimeVoicePresetId,
      domainLexiconPack: config.domainLexiconPack,
    ).normalizedForCapabilities();
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
      voicePresetId: normalizeVoicePresetId(
        json['voicePresetId'] as String? ?? defaultRealtimeVoicePresetId,
      ),
      domainLexiconPack: normalizeDomainLexiconPack(
        json['domainLexiconPack'] as String? ?? defaultDomainLexiconPack,
      ),
    ).normalizedForCapabilities();
  }

  final RealtimeProcessingMode processingMode;
  final String sourceLanguage;
  final String targetLanguage;
  final RealtimeVoiceOutputMode voiceOutputMode;
  final String voicePresetId;
  final String domainLexiconPack;

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
      realtimeVoicePresetId: voicePresetId,
      domainLexiconPack: domainLexiconPack,
    );
  }

  RealtimeRuntimeSettings copyWith({
    RealtimeProcessingMode? processingMode,
    String? sourceLanguage,
    String? targetLanguage,
    bool? autoSpeakTranslation,
    RealtimeVoiceOutputMode? voiceOutputMode,
    String? voicePresetId,
    String? domainLexiconPack,
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
      voicePresetId: voicePresetId == null
          ? this.voicePresetId
          : normalizeVoicePresetId(voicePresetId),
      domainLexiconPack: domainLexiconPack == null
          ? this.domainLexiconPack
          : normalizeDomainLexiconPack(domainLexiconPack),
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
      'voicePresetId': voicePresetId,
      'domainLexiconPack': domainLexiconPack,
      'autoSpeakTranslation': autoSpeakTranslation,
    };
  }

  RealtimeRuntimeSettings normalizedForCapabilities() {
    if (processingMode != RealtimeProcessingMode.onDevice) return this;
    final normalizedSource = sourceLanguage == autoSourceLanguageCode ||
            onDeviceTranslationLanguageCodes.contains(sourceLanguage)
        ? sourceLanguage
        : autoSourceLanguageCode;
    final normalizedTarget = targetLanguage == autoReverseTargetLanguageCode ||
            onDeviceTranslationLanguageCodes.contains(targetLanguage)
        ? targetLanguage
        : autoReverseTargetLanguageCode;
    final normalizedVoice = voiceOutputMode == RealtimeVoiceOutputMode.myVoice
        ? RealtimeVoiceOutputMode.natural
        : voiceOutputMode;
    if (normalizedSource == sourceLanguage &&
        normalizedTarget == targetLanguage &&
        normalizedVoice == voiceOutputMode &&
        domainLexiconPack == defaultDomainLexiconPack) {
      return this;
    }
    return copyWith(
      sourceLanguage: normalizedSource,
      targetLanguage: normalizedTarget,
      voiceOutputMode: normalizedVoice,
      domainLexiconPack: defaultDomainLexiconPack,
    );
  }

  RealtimeVoiceOutputMode _toggleVoiceOutputMode(bool enabled) {
    if (!enabled) return RealtimeVoiceOutputMode.off;
    return voiceOutputMode == RealtimeVoiceOutputMode.off
        ? RealtimeVoiceOutputMode.natural
        : voiceOutputMode;
  }
}

String normalizeVoicePresetId(String value) {
  final cleaned = value.trim();
  return RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(cleaned)
      ? cleaned
      : defaultRealtimeVoicePresetId;
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
