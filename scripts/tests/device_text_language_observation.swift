import Foundation
@main enum TextLanguageObservationCheck {
  static func main() throws {
    let samples = [
      "The meeting starts at three. Please bring the project report.",
      "会議は三時に始まります。資料を持ってきてください。",
      "La réunion commence à trois heures. Apportez le rapport du projet.",
      "会议下午3点开始，请带上项目报告。", "Okay.", "Hy-MT2", "...", ""]
    let expected = ["en", "ja", "fr", "zh-Hans"]
    for (index, text) in samples.enumerated() {
      let result = DeviceTextLanguageObservation.analyze(text)
      precondition(result["evidence"] as? String == "text_only_not_acoustic")
      precondition(result["method"] as? String == "apple_nl_text_v1")
      if index < expected.count { precondition(result["dominant"] as? String == expected[index]) }
      let data = try JSONSerialization.data(withJSONObject: ["index":index, "observation":result], options: [.sortedKeys])
      print(String(decoding:data,as:UTF8.self))
    }
    print("HOST_APPLE_NL_PASS 8; not iOS device evidence")
  }
}
