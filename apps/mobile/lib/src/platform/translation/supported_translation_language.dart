const autoSourceLanguageCode = 'auto';
const autoReverseTargetLanguageCode = 'auto_reverse';

class SupportedTranslationLanguage {
  const SupportedTranslationLanguage({
    required this.code,
    required this.chineseName,
    required this.englishName,
  });

  final String code;
  final String chineseName;
  final String englishName;
}

const supportedHyMtLanguages = <SupportedTranslationLanguage>[
  SupportedTranslationLanguage(
    code: 'zh',
    chineseName: '中文',
    englishName: 'Chinese',
  ),
  SupportedTranslationLanguage(
    code: 'en',
    chineseName: '英语',
    englishName: 'English',
  ),
  SupportedTranslationLanguage(
    code: 'fr',
    chineseName: '法语',
    englishName: 'French',
  ),
  SupportedTranslationLanguage(
    code: 'pt',
    chineseName: '葡萄牙语',
    englishName: 'Portuguese',
  ),
  SupportedTranslationLanguage(
    code: 'es',
    chineseName: '西班牙语',
    englishName: 'Spanish',
  ),
  SupportedTranslationLanguage(
    code: 'ja',
    chineseName: '日语',
    englishName: 'Japanese',
  ),
  SupportedTranslationLanguage(
    code: 'tr',
    chineseName: '土耳其语',
    englishName: 'Turkish',
  ),
  SupportedTranslationLanguage(
    code: 'ru',
    chineseName: '俄语',
    englishName: 'Russian',
  ),
  SupportedTranslationLanguage(
    code: 'ar',
    chineseName: '阿拉伯语',
    englishName: 'Arabic',
  ),
  SupportedTranslationLanguage(
    code: 'ko',
    chineseName: '韩语',
    englishName: 'Korean',
  ),
  SupportedTranslationLanguage(
    code: 'th',
    chineseName: '泰语',
    englishName: 'Thai',
  ),
  SupportedTranslationLanguage(
    code: 'it',
    chineseName: '意大利语',
    englishName: 'Italian',
  ),
  SupportedTranslationLanguage(
    code: 'de',
    chineseName: '德语',
    englishName: 'German',
  ),
  SupportedTranslationLanguage(
    code: 'vi',
    chineseName: '越南语',
    englishName: 'Vietnamese',
  ),
  SupportedTranslationLanguage(
    code: 'ms',
    chineseName: '马来语',
    englishName: 'Malay',
  ),
  SupportedTranslationLanguage(
    code: 'id',
    chineseName: '印尼语',
    englishName: 'Indonesian',
  ),
  SupportedTranslationLanguage(
    code: 'tl',
    chineseName: '菲律宾语',
    englishName: 'Filipino',
  ),
  SupportedTranslationLanguage(
    code: 'hi',
    chineseName: '印地语',
    englishName: 'Hindi',
  ),
  SupportedTranslationLanguage(
    code: 'zh-Hant',
    chineseName: '繁体中文',
    englishName: 'Traditional Chinese',
  ),
  SupportedTranslationLanguage(
    code: 'pl',
    chineseName: '波兰语',
    englishName: 'Polish',
  ),
  SupportedTranslationLanguage(
    code: 'cs',
    chineseName: '捷克语',
    englishName: 'Czech',
  ),
  SupportedTranslationLanguage(
    code: 'nl',
    chineseName: '荷兰语',
    englishName: 'Dutch',
  ),
  SupportedTranslationLanguage(
    code: 'km',
    chineseName: '高棉语',
    englishName: 'Khmer',
  ),
  SupportedTranslationLanguage(
    code: 'my',
    chineseName: '缅甸语',
    englishName: 'Burmese',
  ),
  SupportedTranslationLanguage(
    code: 'fa',
    chineseName: '波斯语',
    englishName: 'Persian',
  ),
  SupportedTranslationLanguage(
    code: 'gu',
    chineseName: '古吉拉特语',
    englishName: 'Gujarati',
  ),
  SupportedTranslationLanguage(
    code: 'ur',
    chineseName: '乌尔都语',
    englishName: 'Urdu',
  ),
  SupportedTranslationLanguage(
    code: 'te',
    chineseName: '泰卢固语',
    englishName: 'Telugu',
  ),
  SupportedTranslationLanguage(
    code: 'mr',
    chineseName: '马拉地语',
    englishName: 'Marathi',
  ),
  SupportedTranslationLanguage(
    code: 'he',
    chineseName: '希伯来语',
    englishName: 'Hebrew',
  ),
  SupportedTranslationLanguage(
    code: 'bn',
    chineseName: '孟加拉语',
    englishName: 'Bengali',
  ),
  SupportedTranslationLanguage(
    code: 'ta',
    chineseName: '泰米尔语',
    englishName: 'Tamil',
  ),
  SupportedTranslationLanguage(
    code: 'uk',
    chineseName: '乌克兰语',
    englishName: 'Ukrainian',
  ),
  SupportedTranslationLanguage(
    code: 'bo',
    chineseName: '藏语',
    englishName: 'Tibetan',
  ),
  SupportedTranslationLanguage(
    code: 'kk',
    chineseName: '哈萨克语',
    englishName: 'Kazakh',
  ),
  SupportedTranslationLanguage(
    code: 'mn',
    chineseName: '蒙古语',
    englishName: 'Mongolian',
  ),
  SupportedTranslationLanguage(
    code: 'ug',
    chineseName: '维吾尔语',
    englishName: 'Uyghur',
  ),
  SupportedTranslationLanguage(
    code: 'yue',
    chineseName: '粤语',
    englishName: 'Cantonese',
  ),
];

final _languageByCode = {
  for (final language in supportedHyMtLanguages)
    language.code.toLowerCase(): language,
};

String normalizeSourceLanguageCode(String value) {
  final language = _normalizeLanguageCase(value);
  if (language == autoSourceLanguageCode) return autoSourceLanguageCode;
  return isSupportedHyMtLanguageCode(language)
      ? language
      : autoSourceLanguageCode;
}

String normalizeTargetLanguageCode(String value) {
  final language = _normalizeLanguageCase(value);
  if (language == autoReverseTargetLanguageCode) return 'zh';
  return isSupportedHyMtLanguageCode(language) ? language : 'zh';
}

bool isSupportedHyMtLanguageCode(String value) {
  return _languageByCode.containsKey(value.toLowerCase());
}

SupportedTranslationLanguage? findHyMtLanguage(String value) {
  return _languageByCode[value.toLowerCase()];
}

String translationLanguageName(String code, {required bool chinese}) {
  final language = findHyMtLanguage(code);
  if (language == null) return code;
  return chinese ? language.chineseName : language.englishName;
}

String oppositeTargetLanguageCode(String sourceLanguage) {
  return isChineseFamilyLanguage(sourceLanguage) ? 'en' : 'zh';
}

bool isChineseFamilyLanguage(String language) {
  final normalized = _normalizeLanguageCase(language);
  return normalized == 'zh' || normalized == 'zh-Hant' || normalized == 'yue';
}

String _normalizeLanguageCase(String value) {
  final language = value.trim();
  if (language.toLowerCase() == 'zh-hant') return 'zh-Hant';
  return language.toLowerCase();
}
