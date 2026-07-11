import Foundation

final class CoreMlNemotronTestProvider {
  private let providerId = "coreml_nemotron"
  private let modelId = "nemotron_coreml_2240ms"
  private let modelStore = CoreMlNemotronModelStore()
  private lazy var fluidAudioAdapter = CoreMlNemotronFluidAudioAdapter(
    modelStore: modelStore
  )

  func status() -> [String: Any] {
    let bundle = modelStore.findBundle()
    let localModelReady = bundle?.isFluidAudioReady ?? false
    let preparedModelReady = fluidAudioAdapter.preparedModelReady
    let runtimeReady = fluidAudioAdapter.runtimeAvailable
    return [
      "providerId": providerId,
      "modelId": modelId,
      "providerIntegrated": true,
      "runtimeLinked": runtimeReady,
      "ready": runtimeReady && (localModelReady || preparedModelReady),
      "localModelReady": localModelReady,
      "preparedModelReady": preparedModelReady,
      "reason": reason(
        bundleFound: bundle != nil,
        runtimeReady: runtimeReady,
        localModelReady: localModelReady,
        preparedModelReady: preparedModelReady
      ),
      "modelScan": modelStore.scanPayload(),
      "fluidAudio": fluidAudioAdapter.payload()
    ]
  }

  func start(
    arguments: Any?,
    emit: @escaping ([String: Any]) -> Void
  ) async -> [String: Any] {
    let initialStatus = status()
    emit([
      "type": "provider.diagnostic",
      "providerId": providerId,
      "modelId": modelId,
      "runtimeLinked": initialStatus["runtimeLinked"] as? Bool ?? false,
      "modelReady": initialStatus["localModelReady"] as? Bool ?? false,
      "preparedModelReady": initialStatus["preparedModelReady"] as? Bool ?? false,
      "reason": initialStatus["reason"] as? String ?? "unknown",
      "timestampMs": Self.nowMs()
    ])

    do {
      try await fluidAudioAdapter.start(options: runtimeOptions(from: arguments)) { [weak self] segment in
        guard let self else { return }
        emit([
          "type": "speech",
          "segmentId": segment["id"] as? String ?? "",
          "text": segment["text"] as? String ?? "",
          "isFinal": segment["isFinal"] as? Bool ?? false,
          "language": segment["language"] as? String ?? "und",
          "providerId": self.providerId,
          "modelId": self.modelId,
          "timestampMs": Self.nowMs()
        ])
      }
      emit([
        "type": "started",
        "providerId": providerId,
        "modelId": modelId,
        "timestampMs": Self.nowMs()
      ])
      return [
        "started": true,
        "providerId": providerId,
        "modelId": modelId
      ]
    } catch {
      let code = errorCode(from: error)
      emit([
        "type": "error",
        "providerId": providerId,
        "modelId": modelId,
        "code": code,
        "message": error.localizedDescription,
        "timestampMs": Self.nowMs()
      ])
      return [
        "started": false,
        "providerId": providerId,
        "modelId": modelId,
        "reason": code,
        "message": error.localizedDescription,
        "diagnostics": status()
      ]
    }
  }

  func stop(emit: @escaping ([String: Any]) -> Void) async -> [String: Any] {
    do {
      try await fluidAudioAdapter.stop()
      emit([
        "type": "stopped",
        "providerId": providerId,
        "modelId": modelId,
        "timestampMs": Self.nowMs()
      ])
      return ["stopped": true, "providerId": providerId, "modelId": modelId]
    } catch {
      let code = errorCode(from: error)
      emit([
        "type": "error",
        "providerId": providerId,
        "modelId": modelId,
        "code": code,
        "message": error.localizedDescription,
        "timestampMs": Self.nowMs()
      ])
      return [
        "stopped": false,
        "providerId": providerId,
        "modelId": modelId,
        "reason": code,
        "message": error.localizedDescription
      ]
    }
  }

  private func runtimeOptions(from arguments: Any?) -> CoreMlNemotronRuntimeOptions {
    let args = arguments as? [String: Any]
    return CoreMlNemotronRuntimeOptions(
      language: language(from: args),
      audioChunkDurationMs: intArgument("chunkDurationMs", from: args) ?? 320,
      modelChunkMs: intArgument("modelChunkMs", from: args) ?? 2240,
      autoDownloadModel: boolArgument("autoDownloadModel", from: args) ?? false,
      endpointMinSpeechMs: intArgument("endpointMinSpeechMs", from: args) ?? 600,
      endpointSilenceMs: intArgument("endpointSilenceMs", from: args) ?? 1400,
      endpointSpeechThresholdRms:
        doubleArgument("endpointSpeechThresholdRms", from: args) ?? 0.006
    )
  }

  private func language(from args: [String: Any]?) -> String {
    if let language = args?["language"] as? String {
      return language
    }
    return args?["localeId"] as? String ?? "auto"
  }

  private func intArgument(_ name: String, from args: [String: Any]?) -> Int? {
    args?[name] as? Int
  }

  private func boolArgument(_ name: String, from args: [String: Any]?) -> Bool? {
    args?[name] as? Bool
  }

  private func doubleArgument(_ name: String, from args: [String: Any]?) -> Double? {
    if let value = args?[name] as? Double {
      return value
    }
    if let value = args?[name] as? NSNumber {
      return value.doubleValue
    }
    return nil
  }

  private func reason(
    bundleFound: Bool,
    runtimeReady: Bool,
    localModelReady: Bool,
    preparedModelReady: Bool
  ) -> String {
    if !runtimeReady { return "fluidaudio_unavailable" }
    if localModelReady || preparedModelReady { return "ready" }
    if !bundleFound { return "model_not_staged_in_test_app" }
    return "model_incomplete"
  }

  private func errorCode(from error: Error) -> String {
    let nsError = error as NSError
    return nsError.userInfo["code"] as? String ?? nsError.domain
  }

  private static func nowMs() -> Int {
    Int(Date().timeIntervalSince1970 * 1000)
  }
}
