import Foundation

final class CoreMlNemotronLanguageRouter {
  private(set) var currentPrompt: String
  private(set) var lastRouteReason = "initial"
  private(set) var routedTurns = 0
  let mode: String
  let turnPolicy: String

  init(language: String, turnPolicy: String = "alternate") {
    let normalized = Self.normalizedLanguage(language)
    self.turnPolicy = turnPolicy.lowercased() == "sticky"
      ? "sticky"
      : "alternate"
    if normalized == "turn" {
      mode = "turn"
      currentPrompt = "auto"
    } else {
      mode = normalized == "auto" ? "auto" : "fixed"
      currentPrompt = normalized
    }
  }

  func routeAfterFinal(text: String, detectedLanguage _: String?) -> String {
    guard mode == "turn" else { return currentPrompt }
    let textPrompt = Self.turnPrompt(for: text)
    let nextPrompt = routedPrompt(from: textPrompt)
    currentPrompt = nextPrompt
    lastRouteReason = nextPrompt == "auto" ? "mixed_or_unknown" : "text_script"
    routedTurns += 1
    return currentPrompt
  }

  func payload() -> [String: Any] {
    [
      "mode": mode,
      "turnPolicy": turnPolicy,
      "currentPrompt": currentPrompt,
      "lastRouteReason": lastRouteReason,
      "routedTurns": routedTurns
    ]
  }

  static func normalizedLanguage(_ rawLanguage: String) -> String {
    switch rawLanguage.trimmingCharacters(
      in: .whitespacesAndNewlines
    ).lowercased() {
    case "zh", "zh-cn", "cmn", "cmn-hans-cn":
      return "zh-CN"
    case "en", "en-us":
      return "en-US"
    case "turn":
      return "turn"
    case "auto":
      return "auto"
    default:
      return rawLanguage
    }
  }

  static func turnPrompt(for text: String) -> String {
    var hasChinese = false
    var hasLatin = false
    for scalar in text.unicodeScalars {
      if (0x4E00...0x9FFF).contains(scalar.value) {
        hasChinese = true
      } else if (0x41...0x5A).contains(scalar.value)
        || (0x61...0x7A).contains(scalar.value) {
        hasLatin = true
      }
      if hasChinese && hasLatin { return "auto" }
    }
    if hasChinese { return "zh-CN" }
    if hasLatin { return "en-US" }
    return "auto"
  }

  private func routedPrompt(from textPrompt: String) -> String {
    guard turnPolicy == "alternate" else { return textPrompt }
    if textPrompt == "zh-CN" { return "en-US" }
    if textPrompt == "en-US" { return "zh-CN" }
    return "auto"
  }
}
