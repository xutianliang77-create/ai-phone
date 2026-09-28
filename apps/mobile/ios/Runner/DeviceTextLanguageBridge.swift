import Flutter
import Foundation

final class DeviceTextLanguageBridge {
  private var channel: FlutterMethodChannel?
  private let queue = DispatchQueue(label: "cn.qkxy.wujieai.text-language", qos: .userInitiated)
  func register(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: "translation_mobile/text_language", binaryMessenger: messenger)
    self.channel = channel
    channel.setMethodCallHandler { [weak self] call, result in
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
