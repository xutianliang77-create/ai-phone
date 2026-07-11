import Flutter
import UIKit
import Vision

final class OcrBridge: NSObject {
  private static let channelName = "translation_mobile/ocr"

  func register(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: Self.channelName,
      binaryMessenger: messenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "recognizeImage" else {
        result(FlutterMethodNotImplemented)
        return
      }
      self?.recognizeImage(arguments: call.arguments, result: result)
    }
  }

  private func recognizeImage(arguments: Any?, result: @escaping FlutterResult) {
    guard let args = arguments as? [String: Any],
          let imagePath = args["imagePath"] as? String,
          !imagePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      result(FlutterError(
        code: "ocr_missing_image",
        message: "No image path was provided.",
        details: nil
      ))
      return
    }
    guard let cgImage = UIImage(contentsOfFile: imagePath)?.cgImage else {
      result(FlutterError(
        code: "ocr_invalid_image",
        message: "Unable to read image.",
        details: nil
      ))
      return
    }

    let scripts = normalizedScripts(args["scripts"])
    DispatchQueue.global(qos: .userInitiated).async {
      self.performRecognition(cgImage: cgImage, scripts: scripts, result: result)
    }
  }

  private func performRecognition(
    cgImage: CGImage,
    scripts: [String],
    result: @escaping FlutterResult
  ) {
    let request = VNRecognizeTextRequest { request, error in
      if let error {
        DispatchQueue.main.async {
          result(FlutterError(
            code: "ocr_failed",
            message: error.localizedDescription,
            details: nil
          ))
        }
        return
      }
      let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
      let lines = observations
        .sorted(by: self.readingOrder)
        .compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
      DispatchQueue.main.async {
        result([
          "text": lines.joined(separator: "\n"),
          "provider": "ios_vision",
          "scripts": scripts,
        ])
      }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = recognitionLanguages(for: scripts)

    do {
      try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    } catch {
      DispatchQueue.main.async {
        result(FlutterError(
          code: "ocr_failed",
          message: error.localizedDescription,
          details: nil
        ))
      }
    }
  }

  private func normalizedScripts(_ rawScripts: Any?) -> [String] {
    let scripts = (rawScripts as? [String])?.filter { $0 == "chinese" || $0 == "latin" } ?? []
    return scripts.isEmpty ? ["chinese", "latin"] : scripts
  }

  private func recognitionLanguages(for scripts: [String]) -> [String] {
    var languages: [String] = []
    if scripts.contains("chinese") { languages.append("zh-Hans") }
    if scripts.contains("latin") { languages.append("en-US") }
    return languages.isEmpty ? ["zh-Hans", "en-US"] : languages
  }

  private func readingOrder(
    _ lhs: VNRecognizedTextObservation,
    _ rhs: VNRecognizedTextObservation
  ) -> Bool {
    let yDelta = lhs.boundingBox.midY - rhs.boundingBox.midY
    if abs(yDelta) > 0.02 { return yDelta > 0 }
    return lhs.boundingBox.minX < rhs.boundingBox.minX
  }
}
