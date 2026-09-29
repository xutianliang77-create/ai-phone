import Flutter
import Foundation

final class DeviceTextLanguageBridge {
  private var channel: FlutterMethodChannel?
  private let queue = DispatchQueue(label: "cn.qkxy.wujieai.text-language", qos: .userInitiated)
  private let speechEvidence: @MainActor (String,[String:Any])->[String:Any]
  init(speechEvidence: @escaping @MainActor (String,[String:Any])->[String:Any] = { _,_ in [:] }) { self.speechEvidence = speechEvidence }
  func register(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: "translation_mobile/text_language", binaryMessenger: messenger)
    self.channel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      if call.method == "audioEvidence" {
        guard let self, let args = call.arguments as? [String:Any], args.count == 2,
          let session = args["sessionId"] as? String, !session.isEmpty, session.count <= 240,
          let range = args["audioRange"] as? [String:Any], range.count == 3,
          let start = range["startSample"] as? Int, let end = range["endSample"] as? Int,
          let rate = range["sampleRate"] as? Int, [16000,24000].contains(rate), start >= 0, end > start, end-start <= rate*60 else {
          result(FlutterError(code:"audio_evidence_input_invalid",message:nil,details:nil));return
        }
        Task { @MainActor in result(self.speechEvidence(session,range)) };return
      }
      guard call.method == "analyze" else { result(FlutterMethodNotImplemented); return }
      guard let self, let args = call.arguments as? [String: Any], args.count == 1,
        let text = args["text"] as? String, !text.isEmpty, text.utf16.count <= 16000 else {
        result(FlutterError(code: "text_language_input_invalid", message: nil, details: nil)); return
      }
      self.queue.async {
        let observation = DeviceTextLanguageObservation.analyze(text)
        DispatchQueue.main.async { result(observation) }
      }
    }
  }
}
