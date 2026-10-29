import Flutter
import Foundation
import Translation
import UIKit

@MainActor
final class OnDeviceTranslationBridge {
  private let methodChannelName = "translation_mobile/on_device_translation"
  private var resourcePreparation: AnyObject?
  var authorizationCheck: ((String,String,String?) throws -> Void)?
  var currentLicense: (() throws -> String)?
  private var activeSessions:[UUID:Any]=[:]
  private var preparedSessions:[String:Any]=[:]
  private final class RequestState { var cancelled=false; var operation:UUID? }
  private var activeRequests:[String:RequestState]=[:]
  func stopForLicense(){
    for state in activeRequests.values { state.cancelled=true }
    let sessions=Array(activeSessions.values);activeSessions.removeAll()
    let prepared=Array(preparedSessions.values);preparedSessions.removeAll()
    if #available(iOS 26.0,*){
      for item in sessions{(item as? TranslationSession)?.cancel()}
      for item in prepared{(item as? TranslationSession)?.cancel()}
    }
  }
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
    case "warmup":
      warmup(call:call,result:result)
    case "cancel":
      guard let id=stringArgument("requestId",from:call),let state=activeRequests[id] else { result(nil);return }
      state.cancelled=true
      if #available(iOS 26.0,*),let operation=state.operation,
         let session=activeSessions[operation] as? TranslationSession { session.cancel() }
      result(nil)
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

  private func warmup(call:FlutterMethodCall,result:@escaping FlutterResult) {
    guard #available(iOS 26.0,*) else {
      result(flutterError(code:"ios_translation_requires_ios_26",message:"iOS 26 is required.",details:nil));return
    }
    guard let id=stringArgument("requestId",from:call),id.utf8.count<=80,
      id.range(of:"^[A-Za-z0-9-]+$",options:.regularExpression) != nil,activeRequests[id] == nil else {
      result(flutterError(code:"translation_request_invalid",message:"Invalid translation request.",details:nil));return
    }
    let state=RequestState();activeRequests[id]=state
    Task { @MainActor [weak self] in
      guard let self else {return}
      defer {self.activeRequests.removeValue(forKey:id)}
      do {try await self.systemWarmup(call:call,state:state);result(nil)}
      catch let error as V10LicenseFailure {result(self.flutterError(code:error.code,message:"请联网核对本机授权",details:nil))}
      catch let error as OnDeviceTranslationError {result(self.flutterError(code:error.code,message:error.message,details:error.details))}
      catch {result(self.flutterError(code:"translation_preparation_failed",message:"本机翻译准备失败",details:nil))}
    }
  }

  @available(iOS 26.0,*)
  private func systemWarmup(call:FlutterMethodCall,state:RequestState) async throws {
    try requireActive(state)
    let lease=try currentLicense?()
    guard resourcePreparation == nil,let pair=await languagePair(from:call) else {
      throw OnDeviceTranslationError(code:"unsupported_language_pair",message:"翻译语言不可用",details:nil)
    }
    try requireActive(state)
    guard await LanguageAvailability().status(from:pair.source,to:pair.target) == .installed else {
      throw OnDeviceTranslationError(code:"language_pair_not_installed",message:"语言资源未安装",details:nil)
    }
    try requireActive(state)
    try authorizationCheck?(pair.sourceCode,pair.targetCode,lease)
    let session=TranslationSession(installedSource:pair.source,target:pair.target), operation=UUID()
    var cached=false
    state.operation=operation;activeSessions[operation]=session
    defer {activeSessions.removeValue(forKey:operation);state.operation=nil;if !cached {session.cancel()}}
    try await session.prepareTranslation()
    try requireActive(state)
    try authorizationCheck?(pair.sourceCode,pair.targetCode,lease)
    let key=preparedKey(pair.sourceCode,pair.targetCode,lease)
    let prefix="\(pair.sourceCode):\(pair.targetCode):"
    for oldKey in preparedSessions.keys.filter({$0.hasPrefix(prefix) && $0 != key}) {
      (preparedSessions.removeValue(forKey:oldKey) as? TranslationSession)?.cancel()
    }
    if let old=preparedSessions.updateValue(session,forKey:key) as? TranslationSession {old.cancel()}
    cached=true
  }

  private func preparedKey(_ source:String,_ target:String,_ lease:String?) -> String {
    "\(source):\(target):\(lease ?? "")"
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

    let requestId=stringArgument("requestId",from:call) ?? UUID().uuidString
    guard requestId.utf8.count<=80,
      requestId.range(of:"^[A-Za-z0-9-]+$",options:.regularExpression) != nil,
      activeRequests[requestId] == nil else {
      result(flutterError(code:"translation_request_invalid",message:"Invalid translation request.",details:nil));return
    }
    let state=RequestState();activeRequests[requestId]=state
    Task { [weak self] in
      guard let self else { return }
      defer { self.activeRequests.removeValue(forKey:requestId) }
      do {
        let payload = try await self.systemTranslate(text: text, call: call, state: state)
        DispatchQueue.main.async {
          guard !state.cancelled else {result(self.flutterError(code:"translation_cancelled",message:"翻译已停止",details:nil));return}
          do{try self.authorizationCheck?(payload["sourceLanguage"] as? String ?? "",payload["targetLanguage"] as? String ?? "",payload["authorizationLeaseId"] as? String)}
          catch{result(self.flutterError(code:"authorization_required",message:"本机授权已停止",details:nil));return}
          result(payload)
        }
      } catch let error as V10LicenseFailure {
        result(self.flutterError(code:error.code,message:"请联网核对本机授权",details:nil))
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
    call: FlutterMethodCall,
    state: RequestState
  ) async throws -> [String: Any] {
    try requireActive(state)
    let boundLease=try currentLicense?()
    guard resourcePreparation == nil else { throw LocalResourcePreparationError.busy }
    guard let pair = await languagePair(from: call) else {
      throw OnDeviceTranslationError(
        code: "unsupported_language_pair",
        message: "The requested source and target languages are not supported for on-device translation.",
        details: nil
      )
    }
    try requireActive(state)

    let availability = LanguageAvailability()
    let status = await availability.status(from: pair.source, to: pair.target)
    try requireActive(state)
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

    try authorizationCheck?(pair.sourceCode,pair.targetCode,boundLease)
    let key=preparedKey(pair.sourceCode,pair.targetCode,boundLease)
    let prepared=preparedSessions.removeValue(forKey:key) as? TranslationSession
    let session = prepared ?? TranslationSession(installedSource:pair.source,target:pair.target)
    let operation=UUID()
    state.operation=operation
    activeSessions[operation]=session
    defer{activeSessions.removeValue(forKey:operation);state.operation=nil;session.cancel()}
    try requireActive(state)
    if prepared == nil {try await session.prepareTranslation()}
    try requireActive(state)
    try authorizationCheck?(pair.sourceCode,pair.targetCode,boundLease)
    let response = try await session.translate(text)
    try requireActive(state)
    try authorizationCheck?(pair.sourceCode,pair.targetCode,boundLease)
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
      "authorizationLeaseId":boundLease ?? "",
      "sourceLanguage": pair.sourceCode,
      "targetLanguage": pair.targetCode,
      "sourceLocale": response.sourceLanguage.minimalIdentifier,
      "targetLocale": response.targetLanguage.minimalIdentifier
    ]
  }

  private func requireActive(_ state:RequestState) throws {
    if state.cancelled { throw OnDeviceTranslationError(code:"translation_cancelled",message:"翻译已停止",details:nil) }
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
