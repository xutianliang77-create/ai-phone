import Foundation

@main
struct AppleSpeechResourceStateTest {
  static func main() throws {
    var count = 0
    for listed in [false, true] {
      for state in ["installed", "supported", "downloading", "unsupported", "future_sdk_state"] {
        let value = AppleSpeechResourceSnapshot(requestedLanguage: "fr",
          resolvedLocale: "fr-FR", assetStatus: state,
          installedLocales: listed ? ["fr-FR"] : ["ja-JP"],
          reservedLocales: ["fr-FR"], stage: "availability")
        precondition(value.canStart == (state == "installed"))
        precondition(value.localeListed == listed)
        let expected: String
        switch state {
        case "installed": expected = "ready"
        case "supported": expected = listed ? "language_resource_not_ready" : "language_resource_missing"
        case "downloading": expected = "language_resource_downloading"
        case "unsupported": expected = "unsupportedLanguage"
        default: expected = "resource_state_unknown"
        }
        precondition(value.reason == expected)
        if value.canStart { try value.requireReady() }
        else {
          do { try value.requireReady(); fatalError("non-installed state was allowed") }
          catch let error as AppleSpeechResourceReadinessError {
            precondition(error.snapshot.assetStatus == state)
            precondition(error.localizedDescription == expected)
          }
        }
        let bytes = try JSONSerialization.data(withJSONObject: value.payload)
        let json = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        precondition(json["requestedLanguage"] as? String == "fr")
        precondition(json["resolvedLocale"] as? String == "fr-FR")
        precondition(json["assetStatus"] as? String == state)
        precondition(json["reservedLocales"] as? [String] == ["fr-FR"])
        count += 1
      }
    }
    for state in ["installed", "supported", "downloading", "unsupported", "future_sdk_state"] {
      for listed in [false, true] {
        for reservations: [String]? in [nil, [], ["fr-FR"], ["ja-JP"]] {
          let value = AppleSpeechResourceSnapshot(requestedLanguage: "fr",
            resolvedLocale: "fr-FR", assetStatus: state,
            installedLocales: listed ? ["fr-FR"] : [], reservedLocales: reservations, stage: "availability")
          let expected = ["installed", "supported"].contains(state) && listed &&
            reservations != nil && !reservations!.contains("fr-FR")
          precondition(value.canPrepareLocally == expected)
          precondition(value.canStart == (state == "installed"))
          count += 1
        }
      }
    }
    print("APPLE_RESOURCE_STATE_PASS cases=\(count) inference=0 downloads=0")
  }
}
