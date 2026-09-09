import AVFoundation
import CryptoKit
import Foundation
import Speech

@available(iOS 26.0, macOS 26.0, *)
enum AppleSpeechResources {
  static func locale(_ language: String) async throws -> Locale {
    guard !["auto", "turn", ""].contains(language.lowercased()) else {
      throw AppleSpeechFailure.automaticLanguageNotQualified
    }
    guard let locale = await SpeechTranscriber.supportedLocale(
      equivalentTo: Locale(identifier: language)) else {
      throw AppleSpeechFailure.unsupportedLanguage
    }
    return locale
  }

  static let modelName = SileroVadResources.modelName
  static let hashes = SileroVadResources.hashes
  static func sileroURL() throws -> URL { try SileroVadResources.sileroURL() }

  static func snapshot(language: String, locale: Locale,
                       transcriber: SpeechTranscriber, stage: String) async -> AppleSpeechResourceSnapshot {
    let status = await AssetInventory.status(forModules: [transcriber])
    let installed = await SpeechTranscriber.installedLocales.map { $0.identifier(.bcp47) }.sorted()
    #if os(iOS)
    let reserved = await AssetInventory.reservedLocales.map { $0.identifier(.bcp47) }.sorted()
    #else
    // Host probes omit app-scoped iOS reservations; this is not a device snapshot.
    let reserved: [String]? = nil
    #endif
    return AppleSpeechResourceSnapshot(requestedLanguage: language,
      resolvedLocale: locale.identifier(.bcp47), assetStatus: String(describing: status),
      installedLocales: installed, reservedLocales: reserved, stage: stage)
  }

  #if os(iOS)
  static func availability(language: String,
                           configuration: AppleSpeechConfiguration,
                           requiresMicrophone: Bool = true) async -> [String: Any] {
    do {
      guard SpeechTranscriber.isAvailable else { throw AppleSpeechFailure.unsupportedLanguage }
      let locale = try await locale(language)
      let transcriber = SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
      _ = try sileroURL()
      let observed = await snapshot(language: language, locale: locale,
        transcriber: transcriber, stage: "availability")
      let microphone = !requiresMicrophone || AVAudioSession.sharedInstance().recordPermission != .denied
      let speech = SFSpeechRecognizer.authorizationStatus() != .denied &&
        SFSpeechRecognizer.authorizationStatus() != .restricted
      return ["canStart": observed.canStart && microphone && speech,
              "canPrepareLocally": observed.canPrepareLocally && microphone && speech,
              "reason": !microphone || !speech ? "permission_denied" : observed.reason,
              "locale": locale.identifier, "provider": "apple_speech_transcriber",
              "languageEvidence": "user_selected", "automaticLanguageQualified": false,
              "resourcesInstalled": observed.canStart, "qualityQualified": false,
              "resourceSnapshot": observed.payload,
              "effectiveParameters": configuration.parameters,
              "configurationFingerprint": configuration.fingerprint]
    } catch {
      return ["canStart": false, "reason": error.localizedDescription,
              "provider": "apple_speech_transcriber", "qualityQualified": false]
    }
  }
  #endif
}

/// Locale inventory and module readiness are different facts. Only the SDK's
/// module status `installed` grants readiness; neither a listed locale nor a
/// completed installation request can substitute for it.
struct AppleSpeechResourceSnapshot {
  let requestedLanguage: String
  let resolvedLocale: String
  let assetStatus: String
  let installedLocales: [String]
  let reservedLocales: [String]?
  let stage: String
  var localeListed: Bool { installedLocales.contains(resolvedLocale) }
  var canStart: Bool { assetStatus == "installed" }
  var canPrepareLocally: Bool {
    guard ["supported", "installed"].contains(assetStatus), localeListed,
          let reservedLocales else { return false }
    return !reservedLocales.contains(resolvedLocale)
  }
  var reason: String {
    switch assetStatus {
    case "installed": return "ready"
    case "supported": return localeListed ? "language_resource_not_ready" : "language_resource_missing"
    case "downloading": return "language_resource_downloading"
    case "unsupported": return "unsupportedLanguage"
    default: return "resource_state_unknown"
    }
  }
  var payload: [String: Any] {
    var value: [String: Any] = ["schemaVersion": 1, "stage": stage,
      "requestedLanguage": requestedLanguage, "resolvedLocale": resolvedLocale,
      "assetStatus": assetStatus, "localeListedAsInstalled": localeListed,
      "installedLocales": installedLocales, "reason": reason, "canStart": canStart,
      "canPrepareLocally": canPrepareLocally,
      "transcriberPreset": "timeIndexedProgressiveTranscription"]
    if let reservedLocales { value["reservedLocales"] = reservedLocales }
    return value
  }
  func requireReady() throws {
    guard canStart else { throw AppleSpeechResourceReadinessError(snapshot: self) }
  }
}

struct AppleSpeechResourceReadinessError: Error, LocalizedError {
  let snapshot: AppleSpeechResourceSnapshot
  var errorDescription: String? { snapshot.reason }
}

struct AppleSpeechResourceRegistrationError: Error, LocalizedError {
  let snapshot: AppleSpeechResourceSnapshot
  let domain: String, code: Int, message: String
  var errorDescription: String? { "resource_local_registration_failed: \(message)" }
  var payload: [String: Any] {
    ["resourceSnapshot": snapshot.payload, "stage": "prepare_local_reservation",
     "errorDomain": domain, "errorCode": code, "errorMessage": message]
  }
}
