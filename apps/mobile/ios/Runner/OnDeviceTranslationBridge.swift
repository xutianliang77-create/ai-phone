import Flutter
import Foundation
import Translation

final class OnDeviceTranslationBridge {
  private let methodChannelName = "translation_mobile/on_device_translation"

  func register(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(
      name: methodChannelName,
      binaryMessenger: messenger
    )
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call: call, result: result)
    }
  }

  private func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "isAvailable":
      isAvailable(call: call, result: result)
    case "translate":
      translate(call: call, result: result)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func isAvailable(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard #available(iOS 26.0, *) else {
      result([
        "available": false,
        "provider": "ios_system",
        "reason": "ios_translation_requires_ios_26"
      ])
      return
    }

    Task { [weak self] in
      guard let self else { return }
      let payload = await self.systemAvailabilityPayload(call: call)
      DispatchQueue.main.async {
        result(payload)
      }
    }
  }

  private func translate(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard #available(iOS 26.0, *) else {
      result(flutterError(
        code: "on_device_translation_unavailable",
        message: "iOS system translation requires iOS 26 or newer.",
        details: nil
      ))
      return
    }

    guard let text = stringArgument("text", from: call)?.trimmingCharacters(
      in: .whitespacesAndNewlines
    ), !text.isEmpty else {
      result(flutterError(
        code: "nothing_to_translate",
        message: "No text was provided for on-device translation.",
        details: nil
      ))
      return
    }

    Task { [weak self] in
      guard let self else { return }
      do {
        let payload = try await self.systemTranslate(text: text, call: call)
        DispatchQueue.main.async {
          result(payload)
        }
      } catch let error as OnDeviceTranslationError {
        DispatchQueue.main.async {
          result(self.flutterError(
            code: error.code,
            message: error.message,
            details: error.details
          ))
        }
      } catch {
        DispatchQueue.main.async {
          result(self.flutterError(
            code: "on_device_translation_failed",
            message: error.localizedDescription,
            details: nil
          ))
        }
      }
    }
  }

  @available(iOS 26.0, *)
  private func systemAvailabilityPayload(call: FlutterMethodCall) async -> [String: Any] {
    guard let pair = languagePair(from: call) else {
      return [
        "available": false,
        "provider": "ios_system",
        "reason": "unsupported_language_pair"
      ]
    }
    let status = await LanguageAvailability().status(
      from: pair.source,
      to: pair.target
    )
    return [
      "available": status == .installed,
      "provider": "ios_system",
      "sourceLanguage": pair.sourceCode,
      "targetLanguage": pair.targetCode,
      "status": statusName(status),
      "reason": status == .installed ? "ready" : "language_pair_not_installed"
    ]
  }

  @available(iOS 26.0, *)
  private func systemTranslate(
    text: String,
    call: FlutterMethodCall
  ) async throws -> [String: Any] {
    guard let pair = languagePair(from: call) else {
      throw OnDeviceTranslationError(
        code: "unsupported_language_pair",
        message: "Only Chinese-English on-device translation is supported.",
        details: nil
      )
    }

    let availability = LanguageAvailability()
    let status = await availability.status(from: pair.source, to: pair.target)
    guard status == .installed else {
      throw OnDeviceTranslationError(
        code: "language_pair_not_installed",
        message: "The requested on-device translation language pair is not installed.",
        details: [
          "provider": "ios_system",
          "sourceLanguage": pair.sourceCode,
          "targetLanguage": pair.targetCode,
          "status": statusName(status)
        ]
      )
    }

    let session = TranslationSession(
      installedSource: pair.source,
      target: pair.target
    )
    try await session.prepareTranslation()
    let response = try await session.translate(text)
    let translatedText = response.targetText.trimmingCharacters(
      in: .whitespacesAndNewlines
    )
    if translatedText.isEmpty {
      throw OnDeviceTranslationError(
        code: "empty_translation",
        message: "iOS system translation returned empty text.",
        details: nil
      )
    }
    return [
      "text": translatedText,
      "provider": "ios_system",
      "sourceLanguage": pair.sourceCode,
      "targetLanguage": pair.targetCode
    ]
  }

  @available(iOS 26.0, *)
  private func languagePair(from call: FlutterMethodCall) -> TranslationLanguagePair? {
    let targetCode = normalizedLanguageCode(
      stringArgument("targetLanguage", from: call),
      fallback: "zh"
    )
    guard targetCode == "zh" || targetCode == "en" else { return nil }

    var sourceCode = normalizedLanguageCode(
      stringArgument("sourceLanguage", from: call),
      fallback: "auto"
    )
    if sourceCode == "auto" {
      sourceCode = targetCode == "zh" ? "en" : "zh"
    }
    guard sourceCode != targetCode,
          (sourceCode == "zh" || sourceCode == "en") else {
      return nil
    }

    return TranslationLanguagePair(
      source: Locale.Language(identifier: sourceCode),
      target: Locale.Language(identifier: targetCode),
      sourceCode: sourceCode,
      targetCode: targetCode
    )
  }

  private func normalizedLanguageCode(_ value: String?, fallback: String) -> String {
    let lowercased = (value ?? fallback).trimmingCharacters(
      in: .whitespacesAndNewlines
    ).lowercased()
    if lowercased == "auto" { return "auto" }
    if lowercased.hasPrefix("zh") || lowercased.hasPrefix("cmn") {
      return "zh"
    }
    if lowercased.hasPrefix("en") {
      return "en"
    }
    return fallback
  }

  @available(iOS 18.0, *)
  private func statusName(_ status: LanguageAvailability.Status) -> String {
    switch status {
    case .installed:
      return "installed"
    case .supported:
      return "supported"
    case .unsupported:
      return "unsupported"
    @unknown default:
      return "unknown"
    }
  }

  private func stringArgument(_ name: String, from call: FlutterMethodCall) -> String? {
    let arguments = call.arguments as? [String: Any]
    return arguments?[name] as? String
  }

  private func flutterError(
    code: String,
    message: String,
    details: Any?
  ) -> FlutterError {
    FlutterError(code: code, message: message, details: details)
  }
}

@available(iOS 26.0, *)
private struct TranslationLanguagePair {
  let source: Locale.Language
  let target: Locale.Language
  let sourceCode: String
  let targetCode: String
}

private struct OnDeviceTranslationError: Error {
  let code: String
  let message: String
  let details: Any?
}
