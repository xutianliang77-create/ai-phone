import Foundation

@main
struct OnDeviceTranslationLanguageTest {
  static func main() {
    for (input, expected) in ["fr-FR": "fr", "ja_JP": "ja", "EN-us": "en",
      "zh-Hant": "zh-Hant", "zh-TW": "zh-Hant", "cmn-Hant-TW": "zh-Hant",
      "zh-Hans-CN": "zh", "yue-HK": "yue", "pt-BR": "pt"] {
      precondition(OnDeviceTranslationLanguage.code(input) == expected)
    }
    for input in ["", "auto", "und", "fr??", "en--US", "garbage"] {
      precondition(OnDeviceTranslationLanguage.code(input) == nil)
    }
    precondition(OnDeviceTranslationLanguage.code(nil) == nil)
    let supported = ["fr-FR", "ja-JP", "en-US", "zh-Hans-CN", "zh-Hant-TW", "yue-HK"]
      .map { Locale.Language(identifier: $0) }
    precondition(OnDeviceTranslationLanguage.resolve("fr", supported: supported)?.languageCode?.identifier == "fr")
    precondition(OnDeviceTranslationLanguage.resolve("ja", supported: supported)?.languageCode?.identifier == "ja")
    precondition(OnDeviceTranslationLanguage.resolve("xx", supported: supported) == nil)
    precondition(OnDeviceTranslationLanguage.resolve("zh-Hant", supported: [Locale.Language(identifier: "zh-Hans-CN")]) == nil)
    precondition(!OnDeviceTranslationLanguage.matches(Locale.Language(identifier: "zh-Hans-CN"), code: "zh-Hant"))
    precondition(!OnDeviceTranslationLanguage.matches(Locale.Language(identifier: "en-US"), code: "fr"))
    print("PASS strict language/locale mapping, non-Chinese pairs, Traditional/Cantonese separation and no fallback")
  }
}
