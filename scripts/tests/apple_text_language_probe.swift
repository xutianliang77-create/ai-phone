import Foundation
import NaturalLanguage

@main
struct AppleTextLanguageProbe {
  static func main() throws {
    guard CommandLine.arguments.count == 2 else { fatalError("existing ASR result JSON required") }
    let input = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let report = try JSONSerialization.jsonObject(with: input) as! [String: Any]
    let cases = report["rows"] as! [[String: Any]]
    var rows: [[String: Any]] = []
    for row in cases {
      let reference = row["reference"] as! String, observed = row["text"] as? String ?? ""
      rows.append(["id": row["id"]!, "expectedLanguage": row["expectedLanguage"]!,
                   "asrLocale": row["locale"] ?? NSNull(), "reference": reference,
                   "asrText": observed, "referenceLanguage": analyze(reference),
                   "asrTextLanguage": analyze(observed)])
    }
    let output: [String: Any] = ["source": CommandLine.arguments[1], "rows": rows,
      "scope": "macOS NaturalLanguage on retained iPhone ASR outputs and references; not new ASR inference",
      "os": ProcessInfo.processInfo.operatingSystemVersionString, "constraints": [], "hints": [:],
      "modelDownloads": false, "deviceQualified": false]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]))
  }
  private static func analyze(_ text: String) -> [String: Any] {
    let begin = ProcessInfo.processInfo.systemUptime
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    return ["evidence": "text_only_not_acoustic", "dominant": recognizer.dominantLanguage?.rawValue ?? "unknown",
      "hypotheses": Dictionary(uniqueKeysWithValues: recognizer.languageHypotheses(withMaximum: 3).map { ($0.key.rawValue, $0.value) }),
      "elapsedMs": (ProcessInfo.processInfo.systemUptime - begin) * 1000]
  }
}
