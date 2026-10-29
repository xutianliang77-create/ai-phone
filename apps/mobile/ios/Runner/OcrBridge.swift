import Flutter
import UIKit
import Vision
import NaturalLanguage

final class OcrBridge: NSObject {
  var authorizationCheck: ((String?) throws -> Void)?
  var currentLicense: (() throws -> String)?
  private let requestLock=NSLock()
  private var activeRequests=[UUID:VNRequest]()
  func stopForLicense(){requestLock.lock();let requests=Array(activeRequests.values);activeRequests.removeAll();requestLock.unlock();for r in requests{r.cancel()}}

  private static let channelName = "translation_mobile/ocr"

  func register(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: Self.channelName,
      binaryMessenger: messenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      if call.method == "supportedLanguages" {
        let request=VNRecognizeTextRequest();request.recognitionLevel = .accurate
        do { result(try request.supportedRecognitionLanguages()) }
        catch { result(FlutterError(code:"ocr_capability_unavailable",message:"无法读取文字识别语言",details:nil)) }
        return
      }
      if call.method == "detectLanguage" {
        self?.detectLanguage(arguments: call.arguments, result: result)
        return
      }
      guard call.method == "recognizeImage" else {
        result(FlutterMethodNotImplemented)
        return
      }
      self?.recognizeImage(arguments: call.arguments, result: result)
    }
  }

  private func detectLanguage(arguments: Any?, result: @escaping FlutterResult) {
    let boundLease:String?
    do { boundLease=try currentLicense?();try authorizationCheck?(boundLease) }
    catch { result(FlutterError(code:"authorization_required",message:"请联网更新本机授权",details:nil));return }
    guard let args=arguments as? [String:Any],let text=args["text"] as? String,
      text.utf8.count <= 65536 else {
      result(FlutterError(code:"invalid_text",message:"无法识别文字语言",details:nil));return
    }
    let characters=text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
    guard characters >= 4 else { result(["reason":"insufficient_evidence"]);return }
    let detector=NLLanguageRecognizer();detector.processString(text)
    let ranked=detector.languageHypotheses(withMaximum:3).sorted { $0.value > $1.value }
    guard let first=ranked.first,first.value >= 0.75,
      first.value-(ranked.dropFirst().first?.value ?? 0) >= 0.20 else {
      result(["reason":"uncertain"]);return
    }
    let raw=first.key.rawValue.lowercased()
    let language: String?
    if raw == "en" || raw.hasPrefix("en-") { language="en" }
    else if raw == "zh-hans" || raw == "zh" { language="zh" }
    else { language=nil } // Do not classify traditional Chinese, Japanese or another language as Mandarin/English.
    do { try authorizationCheck?(boundLease) }
    catch { result(FlutterError(code:"authorization_required",message:"本机授权已停止",details:nil));return }
    result(language.map { ["language":$0,"confidence":first.value] } ?? ["reason":"outside_pair"])
  }

  private func recognizeImage(arguments: Any?, result: @escaping FlutterResult) {
    let boundLease:String?
    do{boundLease=try currentLicense?();try authorizationCheck?(boundLease)}catch{result(FlutterError(code:"authorization_required",message:"请联网更新本机授权",details:nil));return}
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
    guard let image = UIImage(contentsOfFile: imagePath),
          let cgImage = image.cgImage else {
      result(FlutterError(
        code: "ocr_invalid_image",
        message: "Unable to read image.",
        details: nil
      ))
      return
    }

    let scripts = normalizedScripts(args["scripts"])
    let orientation = cgImageOrientation(image.imageOrientation)
    DispatchQueue.global(qos: .userInitiated).async {
      self.performRecognition(
        cgImage: cgImage,
        orientation: orientation,
        scripts: scripts,
        boundLease: boundLease,
        result: result
      )
    }
  }

  private func performRecognition(
    cgImage: CGImage,
    orientation: CGImagePropertyOrientation,
    scripts: [String],
    boundLease: String?,
    result: @escaping FlutterResult
  ) {
    let id=UUID(),replyLock=NSLock();var replied=false
    func finish(_ value:Any?){replyLock.lock();guard !replied else{replyLock.unlock();return};replied=true;replyLock.unlock();result(value)}
    let request = VNRecognizeTextRequest { request, error in
      if let error {
        DispatchQueue.main.async {
          finish(FlutterError(
            code: "ocr_failed",
            message: error.localizedDescription,
            details: nil
          ))
        }
        return
      }
      let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
      let blocks = observations
        .sorted(by: self.readingOrder)
        .compactMap(self.resultBlock)
      DispatchQueue.main.async {
        do{try self.authorizationCheck?(boundLease)}catch{finish(FlutterError(code:"authorization_required",message:"本机授权已停止",details:nil));return}
        finish([
          "text": blocks.compactMap { $0["text"] as? String }.joined(separator: "\n"),
          "provider": "ios_vision",
          "scripts": scripts,
          "blocks": blocks,
        ])
      }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = recognitionLanguages(for: scripts)
    requestLock.lock();activeRequests[id]=request;requestLock.unlock()
    defer{requestLock.lock();activeRequests.removeValue(forKey:id);requestLock.unlock()}
    let authorized=DispatchQueue.main.sync { () -> Bool in do{try self.authorizationCheck?(boundLease);return true}catch{return false} }
    if !authorized{DispatchQueue.main.async{finish(FlutterError(code:"authorization_required",message:"本机授权已停止",details:nil))};return}

    do {
      try VNImageRequestHandler(
        cgImage: cgImage,
        orientation: orientation,
        options: [:]
      ).perform([request])
    } catch {
      DispatchQueue.main.async {
        finish(FlutterError(
          code: "ocr_failed",
          message: error.localizedDescription,
          details: nil
        ))
      }
    }
  }

  private func cgImageOrientation(
    _ orientation: UIImage.Orientation
  ) -> CGImagePropertyOrientation {
    switch orientation {
    case .up: return .up
    case .upMirrored: return .upMirrored
    case .down: return .down
    case .downMirrored: return .downMirrored
    case .left: return .left
    case .leftMirrored: return .leftMirrored
    case .right: return .right
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }

  private func resultBlock(_ observation: VNRecognizedTextObservation) -> [String: Any]? {
    guard let text = observation.topCandidates(1).first?.string
      .trimmingCharacters(in: .whitespacesAndNewlines),
      !text.isEmpty else {
      return nil
    }
    let bounds = observation.boundingBox
    return [
      "text": text,
      "left": bounds.minX,
      "top": 1 - bounds.maxY,
      "width": bounds.width,
      "height": bounds.height,
    ]
  }

  private func normalizedScripts(_ rawScripts: Any?) -> [String] {
    let scripts = (rawScripts as? [String])?.filter { $0 == "chinese" || $0 == "latin" } ?? []
    return scripts.isEmpty ? ["chinese", "latin"] : scripts
  }

  private func recognitionLanguages(for scripts: [String]) -> [String] {
    var languages: [String] = []
    for script in scripts {
      let language: String?
      switch script {
      case "chinese": language = "zh-Hans"
      case "latin": language = "en-US"
      default: language = nil
      }
      if let language, !languages.contains(language) {
        languages.append(language)
      }
    }
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
