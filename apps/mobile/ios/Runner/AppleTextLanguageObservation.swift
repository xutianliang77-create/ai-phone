import Foundation
import NaturalLanguage

/// A fresh recognizer for every request: no previous account, turn or language
/// hints can bias the next sentence. This reads text only and opens no microphone.
enum DeviceTextLanguageObservation {
  static func analyze(_ text: String) -> [String: Any] {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    return ["evidence": "text_only_not_acoustic", "method": "apple_nl_text_v1",
      "dominant": recognizer.dominantLanguage?.rawValue as Any? ?? NSNull(),
      "hypotheses": Dictionary(uniqueKeysWithValues:
        recognizer.languageHypotheses(withMaximum: 3).map { ($0.key.rawValue, $0.value) })]
  }
}

#if WUJIE_APPLE_FILE_PROBE
/// QA observation only. Never participates in source/target routing or ASR locale selection.
enum AppleTextLanguageObservation {
  static func analyze(_ asrText: String) -> [String: Any] {
    let observation = DeviceTextLanguageObservation.analyze(asrText)
    return ["evidence": "text_only_not_acoustic", "qualityQualified": false,
      "dominant": observation["dominant"] as? String ?? "unknown",
      "hypotheses": observation["hypotheses"] ?? [String: Double](),
      "hints": [String: Double](), "constraints": [String]()]
  }
}
#endif
