import Flutter
import Foundation
import Translation
import UIKit

final class OnDeviceTranslationBridge {
  private let methodChannelName = "translation_mobile/on_device_translation"
  private var resourcePreparation: AnyObject?
  private var presenter: () -> UIViewController? = { nil }

  func register(messenger: FlutterBinaryMessenger, presenter: @escaping () -> UIViewController? = { nil }) {
    self.presenter = presenter
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
    case "prepare", "cancelPreparation":
      Task { @MainActor [weak self] in
        guard let self else { return }
        guard #available(iOS 26.0, *) else {
          result(self.flutterError(code: "ios_translation_requires_ios_26", message: "iOS 26 is required.", details: nil)); return
        }
        do {
          let args = call.arguments as? [String: Any] ?? [:]
          let id = try validatedResourceRequestID(args)
          if call.method == "cancelPreparation" {
            if let preparation = self.resourcePreparation as? OnDeviceTranslationPreparation, preparation.id == id {
              preparation.cancel()
            }
          } else { try await self.prepareResources(call: call, id: id) }
          result(nil)
        } catch {
          result(self.flutterError(code: (error as? OnDeviceTranslationError)?.code ?? localResourcePreparationErrorCode(error),
            message: error.localizedDescription, details: nil))
        }
      }
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
    if resourcePreparation != nil {
      return ["available": false, "provider": "ios_system", "reason": "resource_preparation_busy"]
    }
    guard let pair = await languagePair(from: call) else {
      return [
        "available": false,
        "provider": "ios_system",
        "reason": "unsupported_language_pair",
        "sourceLanguage": stringArgument("sourceLanguage", from: call) ?? "",
        "targetLanguage": stringArgument("targetLanguage", from: call) ?? ""
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
      "reason": status == .installed ? "ready" :
        status == .unsupported ? "unsupported_language_pair" : "language_pair_not_installed",
      "sourceLocale": pair.source.minimalIdentifier,
      "targetLocale": pair.target.minimalIdentifier
    ]
  }

  @available(iOS 26.0, *)
  private func systemTranslate(
    text: String,
    call: FlutterMethodCall
  ) async throws -> [String: Any] {
    guard resourcePreparation == nil else { throw LocalResourcePreparationError.busy }
    guard let pair = await languagePair(from: call) else {
      throw OnDeviceTranslationError(
        code: "unsupported_language_pair",
        message: "The requested source and target languages are not supported for on-device translation.",
        details: nil
      )
    }

    let availability = LanguageAvailability()
    let status = await availability.status(from: pair.source, to: pair.target)
    guard status == .installed else {
      throw OnDeviceTranslationError(
        code: status == .unsupported ? "unsupported_language_pair" : "language_pair_not_installed",
        message: "The requested on-device translation language pair is not ready.",
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
    guard OnDeviceTranslationLanguage.matches(response.sourceLanguage, code: pair.sourceCode),
          OnDeviceTranslationLanguage.matches(response.targetLanguage, code: pair.targetCode) else {
      throw OnDeviceTranslationError(
        code: "translation_language_mismatch",
        message: "System translation returned a different language pair.",
        details: ["sourceLocale": response.sourceLanguage.minimalIdentifier,
                  "targetLocale": response.targetLanguage.minimalIdentifier]
      )
    }
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
      "targetLanguage": pair.targetCode,
      "sourceLocale": response.sourceLanguage.minimalIdentifier,
      "targetLocale": response.targetLanguage.minimalIdentifier
    ]
  }

  @available(iOS 26.0, *)
  @MainActor
  private func prepareResources(call: FlutterMethodCall, id: String) async throws {
    guard resourcePreparation == nil else { throw LocalResourcePreparationError.busy }
    let args = call.arguments as? [String: Any] ?? [:]
    _ = try authorizedResourceRequestID(args)
    let operation = OnDeviceTranslationPreparation(id: id)
    resourcePreparation = operation
    defer { if resourcePreparation === operation { resourcePreparation = nil } }
    guard let pair = await languagePair(from: call) else {
      throw OnDeviceTranslationError(code: "unsupported_language_pair", message: "Unsupported language pair.", details: nil)
    }
    try operation.ensureActive()
    let status = await LanguageAvailability().status(from: pair.source, to: pair.target)
    try operation.ensureActive()
    if status == .installed { return }
    guard status == .supported else {
      throw OnDeviceTranslationError(code: "unsupported_language_pair", message: "Unsupported language pair.", details: nil)
    }
    // The SDK's installedSource initializer cannot obtain download permission.
    // Use its attached SwiftUI task in a temporary sheet above the original App.
    try await operation.run(source: pair.source, target: pair.target, presenter: presenter())
    guard await LanguageAvailability().status(from: pair.source, to: pair.target) == .installed else {
      throw LocalResourcePreparationError.notReady
    }
  }

  @available(iOS 26.0, *)
  private func languagePair(from call: FlutterMethodCall) async -> TranslationLanguagePair? {
    guard let sourceCode = OnDeviceTranslationLanguage.code(stringArgument("sourceLanguage", from: call)),
          let targetCode = OnDeviceTranslationLanguage.code(stringArgument("targetLanguage", from: call)),
          sourceCode != targetCode else { return nil }
    let supported = await LanguageAvailability().supportedLanguages
    guard let source = OnDeviceTranslationLanguage.resolve(sourceCode, supported: supported),
          let target = OnDeviceTranslationLanguage.resolve(targetCode, supported: supported) else { return nil }
    return TranslationLanguagePair(source: source, target: target,
                                   sourceCode: sourceCode, targetCode: targetCode)
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
