import Foundation

@main
struct SystemSpeechVoicePolicyTest {
  static func main() {
    let cases: [(String, String, Bool)] = [
      ("fr-FR", "fr", true), ("ja-JP", "fr", false), ("en-US", "en-GB", false),
      ("en_GB", "en-GB", true), ("zh-CN", "zh", true), ("zh-TW", "zh-Hant", true),
      ("zh-HK", "zh-Hant", false), ("zh-CN", "zh-Hant", false), ("zh-HK", "yue", false),
      ("zh-HK", "cmn-HK", false),
      ("yue-HK", "yue", true), ("fr-FR", "fr-CA", false), ("zh-CN", "zh-Hans", true),
      ("sr-Cyrl-RS", "sr-Latn", false), ("sr-Latn-RS", "sr-Latn", true),
      ("en-US", "auto", false), ("und-US", "und-US", false), ("en-US", "en--US", false),
    ]
    for (actual, requested, expected) in cases {
      precondition(SystemSpeechVoicePolicy.matches(actual, requested: requested) == expected, "\(actual) / \(requested)")
    }
    func voice(_ id: String, _ lang: String = "fr-FR", _ quality: Int = 1,
               personal: Bool = false, novelty: Bool = false) -> SystemSpeechVoiceDescriptor {
      .init(identifier: id, name: "test", language: lang, quality: quality, personal: personal, novelty: novelty)
    }
    let voices = [voice("com.apple.voice.default"), voice("com.apple.voice.premium", "fr-FR", 3),
      voice("third.party.voice"), voice("com.apple.voice.personal", personal: true),
      voice("com.apple.voice.novelty", novelty: true), voice("com.apple.voice.wrong", "en-US")]
    let preferred = SystemSpeechVoicePolicy.candidates(voices, language: "fr", preferredIdentifier: "com.apple.voice.default")
    precondition(preferred.map(\.identifier) == ["com.apple.voice.default", "com.apple.voice.premium"])
    let ranked = SystemSpeechVoicePolicy.candidates(voices, language: "fr", preferredIdentifier: "third.party.voice")
    precondition(ranked.map(\.quality) == [3, 1])
    precondition(SystemSpeechVoicePolicy.candidates(voices, language: "ja", preferredIdentifier: nil).isEmpty)
    print("PASS strict voice language/region/script, ambiguous Chinese/Cantonese separation, eligible system IDs, personal/novelty exclusion and deterministic preference")
  }
}
