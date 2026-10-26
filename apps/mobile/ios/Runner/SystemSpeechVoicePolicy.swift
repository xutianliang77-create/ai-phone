import Foundation

struct SystemSpeechVoiceDescriptor {
  let identifier: String
  let name: String
  let language: String
  let quality: Int
  let personal: Bool
  let novelty: Bool
}

/// Speech has stricter region/script requirements than text translation.
/// Ambiguous zh-HK/zh-MO are not silently treated as Mandarin or yue aliases.
enum SystemSpeechVoicePolicy {
  static func normalized(_ raw: String) -> String? {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "_", with: "-").lowercased()
    guard value.range(of: "^[a-z]{2,3}(-[a-z0-9]{2,8})*$", options: .regularExpression) != nil,
          !["auto", "und", "mul", "zxx"].contains(String(value.split(separator: "-")[0])) else { return nil }
    return value
  }
  static func family(_ raw: String) -> String? {
    guard let value = normalized(raw) else { return nil }
    let parts = value.split(separator: "-").map(String.init)
    if ["zh", "cmn"].contains(parts[0]) {
      if let dialect = parts.first(where: { ["hk", "mo"].contains($0) }) { return "\(parts[0])-\(dialect)" }
      if parts.contains("hant") { return "zh-hant" }
      if parts.contains("hans") { return "zh" }
      if parts.contains("tw") { return "zh-hant" }
      return "zh"
    }
    return parts[0]
  }
  static func matches(_ actual: String, requested: String) -> Bool {
    guard let expected = normalized(requested), let observed = normalized(actual),
          family(expected) == family(observed) else { return false }
    let parts = expected.split(separator: "-").dropFirst().map(String.init)
    let actualParts = observed.split(separator: "-").dropFirst().map(String.init)
    for part in parts {
      if part.count == 2 || (part.count == 3 && part.allSatisfy(\.isNumber)) {
        if !actualParts.contains(part) { return false }
      }
      if part.count == 4 && !["hans", "hant"].contains(part) && !actualParts.contains(part) { return false }
    }
    return true
  }
  static func eligible(_ voice: SystemSpeechVoiceDescriptor, language: String) -> Bool {
    let allowed = ["com.apple.voice.", "com.apple.ttsbundle.", "com.apple.speech.synthesis.voice."]
      .contains { voice.identifier.hasPrefix($0) }
    return allowed && !voice.personal && !voice.novelty && !voice.name.isEmpty &&
      matches(voice.language, requested: language)
  }
  static func candidates(_ voices: [SystemSpeechVoiceDescriptor], language: String,
                         preferredIdentifier: String?) -> [SystemSpeechVoiceDescriptor] {
    voices.filter { eligible($0, language: language) }.sorted {
      if ($0.identifier == preferredIdentifier) != ($1.identifier == preferredIdentifier) {
        return $0.identifier == preferredIdentifier
      }
      return $0.quality == $1.quality ? $0.identifier < $1.identifier : $0.quality > $1.quality
    }
  }
}
