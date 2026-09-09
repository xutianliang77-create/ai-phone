import Foundation

/// Canonical product language, never a fallback to a different language.
@available(iOS 16.0, macOS 13.0, *)
enum OnDeviceTranslationLanguage {
  static func code(_ raw: String?) -> String? {
    guard let raw else { return nil }
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "_", with: "-").lowercased()
    guard value.range(of: "^[a-z]{2,3}(-[a-z0-9]{2,8})*$", options: .regularExpression) != nil,
          !["auto", "und"].contains(value) else { return nil }
    let parts = value.split(separator: "-").map(String.init)
    guard let base = parts.first else { return nil }
    if base == "zh" || base == "cmn" {
      if parts.contains("hant") { return "zh-Hant" }
      if parts.contains("hans") { return "zh" }
      return parts.contains(where: { ["tw", "hk", "mo"].contains($0) }) ? "zh-Hant" : "zh"
    }
    return base
  }

  static func matches(_ language: Locale.Language, code expected: String) -> Bool {
    code(language.minimalIdentifier) == expected
  }

  /// SDK-supported locales are authoritative; missing languages are not mapped
  /// to English/Chinese, and Traditional Chinese is not folded into Simplified.
  static func resolve(_ raw: String?, supported: [Locale.Language]) -> Locale.Language? {
    guard let requested = code(raw) else { return nil }
    return supported.first { matches($0, code: requested) }
  }
}
