import '../../../app/app_config.dart';
import '../../../platform/translation/supported_translation_language.dart';
import '../../../platform/translation/translation_language_pair.dart';
import 'voice_preset_catalog.dart';
import 'domain_lexicon_pack.dart';

export '../../../platform/translation/supported_translation_language.dart'
    show onDeviceTranslationLanguageCodes;

enum RealtimeProcessingMode { onDevice, online }

enum RealtimeVoiceOutputMode { off, natural, myVoice }

bool realtimeModeSupportsVoiceOutput(String realtimeMode) {
  return realtimeMode == 'conversation' || realtimeMode == 'meeting';
}

AppConfig applyRealtimeModeVoicePolicy(AppConfig config) {
  if (realtimeModeSupportsVoiceOutput(config.realtimeMode) &&
      !(config.useLocalSessions &&
          config.realtimeVoiceOutputMode == 'my_voice')) {
    return config;
  }
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
    this.automaticLanguagePair,
  });

  factory RealtimeRuntimeSettings.fromConfig(AppConfig config) {
    return RealtimeRuntimeSettings(
      processingMode: config.useLocalSessions
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
      automaticLanguagePair: config.automaticLanguagePair ??
          TranslationLanguagePair.fromLanguages(
              config.sourceLanguage, config.targetLanguage),
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
      automaticLanguagePair:
          TranslationLanguagePair.fromJson(json['automaticLanguagePair']),
    ).normalizedForCapabilities();
  }

  final RealtimeProcessingMode processingMode;
  final String sourceLanguage;
  final String targetLanguage;
  final RealtimeVoiceOutputMode voiceOutputMode;
  final String voicePresetId;
  final String domainLexiconPack;
  final TranslationLanguagePair? automaticLanguagePair;

  TranslationLanguagePair? get selectedLanguagePair {
    final fixed =
        TranslationLanguagePair.fromLanguages(sourceLanguage, targetLanguage);
    if (fixed != null) return fixed;
    final saved = automaticLanguagePair;
    if (saved == null ||
        TranslationLanguagePair.fromLanguages(saved.source, saved.target) ==
            null) {
      return null;
    }
    if (sourceLanguage != autoSourceLanguageCode &&
        saved.opposite(sourceLanguage) == null) {
      return null;
    }
    if (!autoReverseTargetLanguage && saved.opposite(targetLanguage) == null) {
      return null;
    }
    return saved;
  }

  bool get autoSpeakTranslation {
    return voiceOutputMode != RealtimeVoiceOutputMode.off;
  }

  bool get autoReverseTargetLanguage {
    return targetLanguage == autoReverseTargetLanguageCode;
  }

  // Mode policy only; this does not assert that a voice resource is installed.
  bool get allowsSelectedVoiceMode =>
      processingMode != RealtimeProcessingMode.onDevice ||
      voiceOutputMode != RealtimeVoiceOutputMode.myVoice;

  AppConfig applyTo(AppConfig base) {
    final pair = selectedLanguagePair;
    final concreteTarget = autoReverseTargetLanguage
        ? pair?.opposite(sourceLanguage) ??
            pair?.target ??
            _fallbackAutoReverseTarget(sourceLanguage)
        : normalizeTargetLanguageCode(targetLanguage);
    return base.copyWith(
      sourceLanguage: sourceLanguage,
      targetLanguage: concreteTarget,
      autoReverseTargetLanguage: autoReverseTargetLanguage,
      automaticLanguagePair: pair,
      clearAutomaticLanguagePair: pair == null,
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
      automaticLanguagePair: selectedLanguagePair,
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
      if (selectedLanguagePair != null)
        'automaticLanguagePair': selectedLanguagePair!.toJson(),
    };
  }

  RealtimeRuntimeSettings normalizedForCapabilities() {
    // Keep the legacy API without destructively rewriting stored preferences.
    // Provider preflight determines whether the selected capability can run.
    return this;
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
