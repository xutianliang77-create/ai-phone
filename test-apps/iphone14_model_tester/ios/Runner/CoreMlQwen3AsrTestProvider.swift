import Foundation
import CoreML

#if canImport(FluidAudio)
import FluidAudio
#endif

final class CoreMlQwen3AsrTestProvider {
  private let providerId = "coreml_qwen3_asr"
  private let defaultModelId = "qwen3_asr_0_6b_coreml_int8"
  private let modelStore = CoreMlQwen3AsrModelStore()
  private let audioInput = CoreMlNemotronAudioInput()
  private let audioQueue = DispatchQueue(label: "translation_mobile.coreml_qwen3_asr.audio")
  private var audioBuffer: [Float] = []
  private var runtime: Any?
  private var preparedKey: String?
  private var running = false
  private var activeModelId = "qwen3_asr_0_6b_coreml_int8"
  private var activeLanguageHint: String?

  func status(modelId: String? = nil) -> [String: Any] {
    let selectedModelId = modelId ?? activeModelId
    let bundle = modelStore.findBundle(preferredVariant: selectedModelId)
    let modelReady = bundle?.modelReady ?? false
    let runtimeLinked = Self.runtimeLinked
    let runtimeAvailable = Self.runtimeAvailable
    return [
      "providerId": providerId,
      "modelId": selectedModelId,
      "providerIntegrated": true,
      "coreMlLinked": true,
      "runtimeLinked": runtimeLinked,
      "runtimeAvailable": runtimeAvailable,
      "ready": runtimeAvailable && modelReady,
      "modelReady": modelReady,
      "preparedModelReady": runtime != nil,
      "running": running,
      "variant": bundle?.variant as Any,
      "reason": reason(
        modelReady: modelReady,
        runtimeLinked: runtimeLinked,
        runtimeAvailable: runtimeAvailable
      ),
      "modelScan": modelStore.scanPayload(preferredVariant: selectedModelId),
      "audio": audioInput.payload()
    ]
  }

  func start(
    arguments: Any?,
    emit: @escaping ([String: Any]) -> Void
  ) async -> [String: Any] {
    let args = arguments as? [String: Any]
    let modelId = args?["modelId"] as? String ?? defaultModelId
    activeModelId = modelId
    activeLanguageHint = languageHint(from: args)
    audioQueue.sync { audioBuffer.removeAll() }

    let initialStatus = status(modelId: modelId)
    emit([
      "type": "provider.diagnostic",
      "providerId": providerId,
      "modelId": modelId,
      "modelReady": initialStatus["modelReady"] as? Bool ?? false,
      "runtimeLinked": initialStatus["runtimeLinked"] as? Bool ?? false,
      "runtimeAvailable": initialStatus["runtimeAvailable"] as? Bool ?? false,
      "reason": initialStatus["reason"] as? String ?? "unknown",
      "modelScan": initialStatus["modelScan"] as Any,
      "audio": initialStatus["audio"] as Any,
      "timestampMs": Self.nowMs()
    ])

    guard let bundle = modelStore.findBundle(preferredVariant: modelId),
          bundle.modelReady
    else {
      emitError(
        code: "model_not_staged_in_test_app",
        message: "Qwen3 CoreML model files are not staged in this independent test app.",
        emit: emit
      )
      return failure(reason: "model_not_staged_in_test_app")
    }

    guard Self.runtimeLinked else {
      emitError(
        code: "qwen3_coreml_runtime_not_linked",
        message: "FluidAudio Swift package is not linked into the iOS target.",
        emit: emit
      )
      return failure(reason: "qwen3_coreml_runtime_not_linked")
    }

    guard Self.runtimeAvailable else {
      emitError(
        code: "ios18_required",
        message: "FluidAudio Qwen3 ASR runtime requires iOS 18 or newer.",
        emit: emit
      )
      return failure(reason: "ios18_required")
    }

    do {
      try await prepare(bundle: bundle)
      try audioInput.start(chunkDurationMs: chunkDurationMs(from: args)) { [weak self] samples in
        self?.append(samples: samples)
      }
      running = true
      emit([
        "type": "started",
        "providerId": providerId,
        "modelId": modelId,
        "languageHint": activeLanguageHint as Any,
        "timestampMs": Self.nowMs()
      ])
      return [
        "started": true,
        "providerId": providerId,
        "modelId": modelId,
        "languageHint": activeLanguageHint as Any
      ]
    } catch {
      running = false
      _ = audioInput.stop()
      let code = errorCode(from: error)
      emitError(code: code, message: error.localizedDescription, emit: emit)
      return [
        "started": false,
        "providerId": providerId,
        "modelId": modelId,
        "reason": code,
        "message": error.localizedDescription,
        "diagnostics": status(modelId: modelId)
      ]
    }
  }

  func stop(emit: @escaping ([String: Any]) -> Void) async -> [String: Any] {
    let tail = audioInput.stop(flushPending: running)
    if !tail.isEmpty {
      append(samples: tail)
    }
    let samples = audioQueue.sync {
      let result = audioBuffer
      audioBuffer.removeAll()
      return result
    }
    let wasRunning = running
    running = false

    if wasRunning && samples.count >= 1_600 {
      emit([
        "type": "provider.processing",
        "providerId": providerId,
        "modelId": activeModelId,
        "sampleCount": samples.count,
        "timestampMs": Self.nowMs()
      ])
      Task { [samples, emit] in
        do {
          let text = try await self.transcribe(samples: samples)
          self.emitSpeech(text: text, isFinal: true, emit: emit)
        } catch {
          self.emitError(
            code: self.errorCode(from: error),
            message: error.localizedDescription,
            emit: emit
          )
          emit([
            "type": "provider.diagnostic",
            "providerId": self.providerId,
            "modelId": self.activeModelId,
            "audio": self.audioInput.payload(),
            "sampleCount": samples.count,
            "timestampMs": Self.nowMs()
          ])
        }
      }
    }

    emit([
      "type": "stopped",
      "providerId": providerId,
      "modelId": activeModelId,
      "sampleCount": samples.count,
      "audio": audioInput.payload(),
      "timestampMs": Self.nowMs()
    ])
    return [
      "stopped": true,
      "providerId": providerId,
      "modelId": activeModelId,
      "sampleCount": samples.count
    ]
  }

  private func prepare(bundle: CoreMlQwen3AsrBundle) async throws {
    #if canImport(FluidAudio)
    guard #available(iOS 18.0, *) else {
      throw providerError(code: "ios18_required", message: "FluidAudio Qwen3 ASR runtime requires iOS 18 or newer.")
    }
    let key = bundle.rootURL.path
    if runtime != nil && preparedKey == key { return }
    let manager = Qwen3AsrManager()
    try await manager.loadModels(from: bundle.rootURL, computeUnits: .cpuOnly)
    runtime = manager
    preparedKey = key
    #else
    throw providerError(
      code: "qwen3_coreml_runtime_not_linked",
      message: "FluidAudio Swift package is not linked into the iOS target."
    )
    #endif
  }

  private func transcribe(samples: [Float]) async throws -> String {
    #if canImport(FluidAudio)
    guard #available(iOS 18.0, *) else {
      throw providerError(code: "ios18_required", message: "FluidAudio Qwen3 ASR runtime requires iOS 18 or newer.")
    }
    guard let manager = runtime as? Qwen3AsrManager else {
      throw providerError(code: "runtime_not_prepared", message: "Qwen3 ASR runtime was not prepared.")
    }
    return try await manager.transcribe(
      audioSamples: samples,
      language: activeLanguageHint,
      maxNewTokens: 64
    )
    #else
    throw providerError(
      code: "qwen3_coreml_runtime_not_linked",
      message: "FluidAudio Swift package is not linked into the iOS target."
    )
    #endif
  }

  private func append(samples: [Float]) {
    guard !samples.isEmpty else { return }
    audioQueue.async { [weak self] in
      self?.audioBuffer.append(contentsOf: samples)
    }
  }

  private func emitSpeech(
    text: String,
    isFinal: Bool,
    emit: @escaping ([String: Any]) -> Void
  ) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    emit([
      "type": "speech",
      "segmentId": UUID().uuidString,
      "text": trimmed,
      "isFinal": isFinal,
      "language": gatewayLanguageCode(activeLanguageHint),
      "providerId": providerId,
      "modelId": activeModelId,
      "timestampMs": Self.nowMs()
    ])
  }

  private func emitError(
    code: String,
    message: String,
    emit: @escaping ([String: Any]) -> Void
  ) {
    emit([
      "type": "error",
      "providerId": providerId,
      "modelId": activeModelId,
      "code": code,
      "message": message,
      "timestampMs": Self.nowMs()
    ])
  }

  private func failure(reason: String) -> [String: Any] {
    [
      "started": false,
      "providerId": providerId,
      "modelId": activeModelId,
      "reason": reason,
      "diagnostics": status(modelId: activeModelId)
    ]
  }

  private func languageHint(from args: [String: Any]?) -> String? {
    let source = (args?["sourceLanguage"] as? String)
      ?? (args?["language"] as? String)
      ?? (args?["localeId"] as? String)
      ?? "auto"
    let normalized = source.lowercased()
    if normalized == "auto" || normalized == "mixed" { return nil }
    if normalized.hasPrefix("zh") { return "Chinese" }
    if normalized.hasPrefix("en") { return "English" }
    return nil
  }

  private func gatewayLanguageCode(_ hint: String?) -> String {
    guard let hint else { return "und" }
    if hint == "Chinese" { return "zh" }
    if hint == "English" { return "en" }
    return "und"
  }

  private func chunkDurationMs(from args: [String: Any]?) -> Int {
    if let value = args?["chunkDurationMs"] as? Int { return value }
    if let value = args?["chunkDurationMs"] as? NSNumber { return value.intValue }
    return 320
  }

  private func reason(
    modelReady: Bool,
    runtimeLinked: Bool,
    runtimeAvailable: Bool
  ) -> String {
    if !runtimeLinked { return "qwen3_coreml_runtime_not_linked" }
    if !runtimeAvailable { return "ios18_required" }
    if !modelReady { return "model_not_staged_in_test_app" }
    return "ready"
  }

  private func errorCode(from error: Error) -> String {
    let nsError = error as NSError
    return nsError.userInfo["code"] as? String ?? nsError.domain
  }

  private func providerError(code: String, message: String) -> NSError {
    NSError(
      domain: "coreml_qwen3_asr",
      code: 1,
      userInfo: [
        "code": code,
        NSLocalizedDescriptionKey: message
      ]
    )
  }

  private static var runtimeLinked: Bool {
    #if canImport(FluidAudio)
    return true
    #else
    return false
    #endif
  }

  private static var runtimeAvailable: Bool {
    #if canImport(FluidAudio)
    if #available(iOS 18.0, *) {
      return true
    }
    return false
    #else
    return false
    #endif
  }

  private static func nowMs() -> Int {
    Int(Date().timeIntervalSince1970 * 1000)
  }
}
