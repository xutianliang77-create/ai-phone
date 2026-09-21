import '../../../app/app_config.dart';
import '../../../platform/translation/supported_translation_language.dart';
import '../../../platform/translation/translation_language_pair.dart';
import 'voice_preset_catalog.dart';
import 'domain_lexicon_pack.dart';

export '../../../platform/translation/supported_translation_language.dart'
    show onDeviceTranslationLanguageCodes;

enum RealtimeProcessingMode { onDevice, online }

enum RealtimeVoiceOutputMode { off, natural, myVoice }

const _realtimeSettingsStorageSchemaVersion = 2;

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
    this.settingsStorageSchemaVersion =
        _realtimeSettingsStorageSchemaVersion,
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
      settingsStorageSchemaVersion: json['settingsSchemaVersion'] is int
          ? json['settingsSchemaVersion'] as int
          : null,
    ).normalizedForCapabilities();
  }

  final RealtimeProcessingMode processingMode;
  final String sourceLanguage;
  final String targetLanguage;
  final RealtimeVoiceOutputMode voiceOutputMode;
  final String voicePresetId;
  final String domainLexiconPack;
  final TranslationLanguagePair? automaticLanguagePair;
  // A missing version denotes a pre-public-routing settings file. New saves
  // persist both the version and an explicit null when no pair is selected.
  final int? settingsStorageSchemaVersion;

  TranslationLanguagePair? get selectedLanguagePair {
    return _selectedLanguagePairFor(
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      savedPair: automaticLanguagePair,
      autoReverse: autoReverseTargetLanguage,
    );
  }

  static TranslationLanguagePair? _selectedLanguagePairFor({
    required String sourceLanguage,
    required String targetLanguage,
    required TranslationLanguagePair? savedPair,
    required bool autoReverse,
  }) {
    final fixed = TranslationLanguagePair.fromLanguages(
      sourceLanguage,
      targetLanguage,
    );
    if (fixed != null) return fixed;
    final saved = savedPair;
    if (saved == null ||
        TranslationLanguagePair.fromLanguages(saved.source, saved.target) ==
            null) {
      return null;
    }
    if (sourceLanguage != autoSourceLanguageCode &&
        saved.opposite(sourceLanguage) == null) {
      return null;
    }
    if (!autoReverse && saved.opposite(targetLanguage) == null) {
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

  /// Restores only the public build's explicit default pair into legacy
  /// settings. It never infers a pair from a target language, and leaves an
  /// explicit current-version null unchanged.
  RealtimeRuntimeSettings restoreLegacyAutomaticLanguagePair(AppConfig base) {
    if (settingsStorageSchemaVersion != null ||
        processingMode != RealtimeProcessingMode.online ||
        (sourceLanguage != autoSourceLanguageCode &&
            !autoReverseTargetLanguage)) {
      return this;
    }
    final configuredPair = base.automaticLanguagePair;
    if (configuredPair == null) return this;
    final pair = _selectedLanguagePairFor(
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      savedPair: configuredPair,
      autoReverse: autoReverseTargetLanguage,
    );
    if (pair == null) return this;
    final restoreAutomaticSource = autoReverseTargetLanguage &&
        sourceLanguage != autoSourceLanguageCode &&
        base.sourceLanguage == autoSourceLanguageCode &&
        base.autoReverseTargetLanguage &&
        pair.opposite(sourceLanguage) != null;
    return RealtimeRuntimeSettings(
      processingMode: processingMode,
      sourceLanguage:
          restoreAutomaticSource ? autoSourceLanguageCode : sourceLanguage,
      targetLanguage: targetLanguage,
      voiceOutputMode: voiceOutputMode,
      voicePresetId: voicePresetId,
      domainLexiconPack: domainLexiconPack,
      automaticLanguagePair: pair,
    );
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
            // Do not fabricate zh/en or an opposite language when an old
            // automatic setting has lost its pair.  Preserve the last concrete
            // target solely for display/storage; preflight rejects the missing
            // pair before any model/resource operation can start.
            normalizeTargetLanguageCode(base.targetLanguage)
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
    final nextSourceLanguage = sourceLanguage == null
        ? this.sourceLanguage
        : normalizeSourceLanguageCode(sourceLanguage);
    final nextTargetLanguage = targetLanguage == null
        ? this.targetLanguage
        : normalizeTargetSettingCode(targetLanguage);
    // A user may turn an existing fixed A→B choice into automatic routing in
    // either order. Preserve that exact pair as the automatic candidate, then
    // let the existing validation clear it if either new setting no longer
    // belongs to the pair. This never manufactures a default language pair.
    final savedPair = automaticLanguagePair ??
        TranslationLanguagePair.fromLanguages(
          this.sourceLanguage,
          this.targetLanguage,
        );
    return RealtimeRuntimeSettings(
      processingMode: processingMode ?? this.processingMode,
      sourceLanguage: nextSourceLanguage,
      targetLanguage: nextTargetLanguage,
      voiceOutputMode: nextVoiceOutputMode,
      voicePresetId: voicePresetId == null
          ? this.voicePresetId
          : normalizeVoicePresetId(voicePresetId),
      domainLexiconPack: domainLexiconPack == null
          ? this.domainLexiconPack
          : normalizeDomainLexiconPack(domainLexiconPack),
      automaticLanguagePair: _selectedLanguagePairFor(
        sourceLanguage: nextSourceLanguage,
        targetLanguage: nextTargetLanguage,
        savedPair: savedPair,
        autoReverse: nextTargetLanguage == autoReverseTargetLanguageCode,
      ),
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

  Map<String, Object?> toStorageJson() {
    return <String, Object?>{
      ...toJson(),
      'settingsSchemaVersion': _realtimeSettingsStorageSchemaVersion,
      'automaticLanguagePair': selectedLanguagePair?.toJson(),
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

RealtimeRuntimeSettings resolveRealtimeRuntimeSettings(
  AppConfig base,
  RealtimeRuntimeSettings? saved,
) {
  return (saved ?? RealtimeRuntimeSettings.fromConfig(base))
      .restoreLegacyAutomaticLanguagePair(base);
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
