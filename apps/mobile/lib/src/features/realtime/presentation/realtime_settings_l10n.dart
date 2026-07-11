import '../../../app/localization/app_localizations.dart';
import '../../../platform/translation/supported_translation_language.dart';

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
}
