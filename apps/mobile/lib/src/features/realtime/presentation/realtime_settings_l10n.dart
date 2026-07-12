import '../../../app/localization/app_localizations.dart';
import '../../../platform/translation/supported_translation_language.dart';
import '../data/voice_preset_catalog.dart';

extension RealtimeSettingsL10n on AppLocalizations {
  String get realtimeSettingsLabel => isChinese ? '同传设置' : 'Realtime settings';
  String get processingModeLabel => isChinese ? '运行模式' : 'Processing mode';
  String get onDeviceModeLabel => isChinese ? '端侧' : 'On device';
  String get onlineModeLabel => isChinese ? '在线' : 'Online';
  String get sourceLanguageLabel => isChinese ? '源语言' : 'Source';
  String get targetLanguageLabel => isChinese ? '目标语言' : 'Target';
  String get autoDetectLanguageLabel => isChinese ? '自动识别' : 'Auto detect';
  String get autoReverseTargetLabel => isChinese ? '自动反向' : 'Auto reverse';
  String get autoSpeakTranslationLabel =>
      isChinese ? '自动朗读译文' : 'Speak translation';
  String get voiceOutputSettingLabel =>
      isChinese ? '朗读声音' : 'Spoken voice';
  String get voiceOutputOffLabel => isChinese ? '关闭' : 'Off';
  String get voiceOutputNaturalLabel => isChinese ? '自然声音' : 'Natural';
  String get voiceOutputMyVoiceLabel => isChinese ? '我的声音' : 'My Voice';
  String get voicePresetSettingLabel => isChinese ? '自然音色' : 'Natural voice';
  String get voicePresetPickerTitle => isChinese ? '选择朗读音色' : 'Choose voice';
  String get voicePresetLoadingLabel => isChinese ? '正在加载音色' : 'Loading voices';
  String get voicePresetUnavailableLabel => isChinese ? '暂无可用音色' : 'No voice available';
  String get languagePickerTitle => isChinese ? '选择语言' : 'Choose language';
  String get settingsLockedHint =>
      isChinese ? '同传中不可切换设置' : 'Locked while running';
  String get searchLanguageHint =>
      isChinese ? '搜索语言或代码' : 'Search language or code';

  String languageDisplayName(String code) {
    if (code == autoSourceLanguageCode) return autoDetectLanguageLabel;
    if (code == autoReverseTargetLanguageCode) return autoReverseTargetLabel;
    return translationLanguageName(code, chinese: isChinese);
  }

  String voicePresetDescription(VoicePreset preset) {
    final parts = <String>[
      _voiceGenderLabel(preset.gender),
      _voiceToneLabel(preset.tone),
      _voiceScenarioLabel(preset.scenario),
      _voiceAccentLabel(preset.accent),
    ];
    return parts.join(isChinese ? ' · ' : ' · ');
  }

  String _voiceGenderLabel(String value) => switch (value) {
        'female' => isChinese ? '女声' : 'Female',
        'male' => isChinese ? '男声' : 'Male',
        _ => isChinese ? '中性' : 'Neutral',
      };

  String _voiceToneLabel(String value) => switch (value) {
        'steady' => isChinese ? '稳重' : 'Steady',
        'lively' => isChinese ? '活泼' : 'Lively',
        _ => isChinese ? '自然' : 'Natural',
      };

  String _voiceScenarioLabel(String value) => value == 'broadcast'
      ? (isChinese ? '播音' : 'Broadcast')
      : (isChinese ? '对话' : 'Conversation');

  String _voiceAccentLabel(String value) => switch (value) {
        'mandarin' => isChinese ? '普通话' : 'Mandarin',
        'sichuanese' => isChinese ? '四川话' : 'Sichuanese',
        'northeastern_mandarin' => isChinese ? '东北话' : 'Northeastern',
        'cantonese' => isChinese ? '粤语' : 'Cantonese',
        'minnan' => isChinese ? '闽南语' : 'Minnan',
        'american_english' => isChinese ? '美式英语' : 'American English',
        _ => isChinese ? '中英双语' : 'Bilingual',
      };
}
