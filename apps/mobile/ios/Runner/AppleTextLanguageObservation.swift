#if WUJIE_APPLE_FILE_PROBE
import Foundation
import NaturalLanguage

/// QA observation only. Never participates in source/target routing or ASR locale selection.
enum AppleTextLanguageObservation {
  static func analyze(_ asrText: String) -> [String: Any] {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(asrText)
    return ["evidence": "text_only_not_acoustic", "qualityQualified": false,
      "dominant": recognizer.dominantLanguage?.rawValue ?? "unknown",
      "hypotheses": Dictionary(uniqueKeysWithValues:
        recognizer.languageHypotheses(withMaximum: 3).map { ($0.key.rawValue, $0.value) }),
      "hints": [String: Double](), "constraints": [String]()]
  }
}
#endif
