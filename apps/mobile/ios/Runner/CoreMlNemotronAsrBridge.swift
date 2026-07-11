import AVFoundation
import Flutter

final class CoreMlNemotronAsrBridge: NSObject, FlutterStreamHandler {
  private let modelName = "NemotronASRStreaming"
  private let methodChannelName = "translation_mobile/core_ml_nemotron_asr"
  private let eventChannelName = "translation_mobile/core_ml_nemotron_asr/events"
  private let modelStore = CoreMlNemotronModelStore()
  private lazy var fluidAudioAdapter = CoreMlNemotronFluidAudioAdapter(
    modelStore: modelStore
  )
  private var eventSink: FlutterEventSink?
  private var loadedBundle: LoadedCoreMlNemotronBundle?

  func register(messenger: FlutterBinaryMessenger) {
    let methodChannel = FlutterMethodChannel(
      name: methodChannelName,
      binaryMessenger: messenger
    )
    methodChannel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call: call, result: result)
    }

    let eventChannel = FlutterEventChannel(
      name: eventChannelName,
      binaryMessenger: messenger
    )
    eventChannel.setStreamHandler(self)
  }

  func onListen(
    withArguments arguments: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    eventSink = events
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    eventSink = nil
    stopAfterStreamCancel()
    return nil
  }

  private func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "isAvailable":
      result(availabilityPayload())
    case "inspectModel":
      inspectModel(result: result)
    case "requestPermission":
      requestMicrophonePermission(result: result)
    case "prepare":
      prepare(call: call, result: result)
    case "start":
      start(call: call, result: result)
    case "stop":
      stop(result: result)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func requestMicrophonePermission(result: @escaping FlutterResult) {
    AVAudioSession.sharedInstance().requestRecordPermission { granted in
      DispatchQueue.main.async {
        if granted {
          result(nil)
        } else {
          result(FlutterError(
            code: "microphone_permission_denied",
            message: "Microphone permission is required for device ASR",
            details: nil
          ))
        }
      }
    }
  }

  private func start(call: FlutterMethodCall, result: @escaping FlutterResult) {
    Task { [weak self] in
      guard let self else { return }
      do {
        try await self.fluidAudioAdapter.start(
          options: self.runtimeOptions(from: call)
        ) { [weak self] segment in
          DispatchQueue.main.async {
            self?.eventSink?(segment)
          }
        }
        DispatchQueue.main.async {
          result(nil)
        }
      } catch {
        DispatchQueue.main.async {
          result(self.flutterError(
            code: self.errorCode(from: error, fallback: "asr_start_failed"),
            message: error.localizedDescription
          ))
        }
      }
    }
  }

  private func prepare(call: FlutterMethodCall, result: @escaping FlutterResult) {
    Task { [weak self] in
      guard let self else { return }
      do {
        try await self.fluidAudioAdapter.prepare(
          options: self.runtimeOptions(from: call)
        )
        DispatchQueue.main.async {
          result(nil)
        }
      } catch {
        DispatchQueue.main.async {
          result(self.flutterError(
            code: self.errorCode(from: error, fallback: "asr_prepare_failed"),
            message: error.localizedDescription
          ))
        }
      }
    }
  }

  private func stop(result: @escaping FlutterResult) {
    Task { [weak self] in
      guard let self else { return }
      do {
        try await self.fluidAudioAdapter.stop()
        DispatchQueue.main.async {
          result(nil)
        }
      } catch {
        DispatchQueue.main.async {
          result(self.flutterError(
            code: self.errorCode(from: error, fallback: "asr_stop_failed"),
            message: error.localizedDescription
          ))
        }
      }
    }
  }

  private func stopAfterStreamCancel() {
    Task { [weak self] in
      guard let self else { return }
      try? await self.fluidAudioAdapter.stop(keepPrepared: true)
    }
  }

  private func inspectModel(result: FlutterResult) {
    do {
      let bundle = try loadBundle()
      result(bundle.payload())
    } catch {
      result(FlutterError(
        code: "model_inspect_failed",
        message: error.localizedDescription,
        details: availabilityPayload()
      ))
    }
  }

  private func loadBundle() throws -> LoadedCoreMlNemotronBundle {
    if let loadedBundle {
      return loadedBundle
    }
    let loaded = try modelStore.loadBundle()
    loadedBundle = loaded
    return loaded
  }

  private func availabilityPayload() -> [String: Any] {
    let bundle = modelStore.findBundle()
    let localModelReady = bundle?.isFluidAudioReady ?? false
    let preparedModelReady = fluidAudioAdapter.preparedModelReady
    let runtimeReady = fluidAudioAdapter.runtimeAvailable
    var payload: [String: Any] = [
      "available": bundle != nil || preparedModelReady,
      "modelName": bundle?.name ?? modelName,
      "modelPath": bundle?.rootURL.path as Any,
      "layout": bundle?.layout ?? "missing",
      "localModelReady": localModelReady,
      "preparedModelReady": preparedModelReady,
      "microphone": microphonePayload(),
      "components": bundle?.componentPayload() ?? [:],
      "modelScan": modelStore.scanPayload(),
      "fluidAudio": fluidAudioAdapter.payload(),
      "decoderReady": runtimeReady && (localModelReady || preparedModelReady),
      "reason": availabilityReason(
        bundle: bundle,
        runtimeReady: runtimeReady,
        localModelReady: localModelReady,
        preparedModelReady: preparedModelReady
      )
    ]
    if let loadedBundle {
      payload["loadedModels"] = loadedBundle.payload()["models"]
    }
    return payload
  }

  private func availabilityReason(
    bundle: CoreMlNemotronBundle?,
    runtimeReady: Bool,
    localModelReady: Bool,
    preparedModelReady: Bool
  ) -> String {
    if !runtimeReady { return "fluidaudio_unavailable" }
    if localModelReady || preparedModelReady { return "ready" }
    guard bundle != nil else { return "model_not_found" }
    return "model_incomplete"
  }

  private func microphonePayload() -> [String: Any] {
    [
      "permission": microphonePermission(),
      "recordPermissionRaw": AVAudioSession.sharedInstance().recordPermission.rawValue
    ]
  }

  private func microphonePermission() -> String {
    switch AVAudioSession.sharedInstance().recordPermission {
    case .undetermined:
      return "undetermined"
    case .denied:
      return "denied"
    case .granted:
      return "granted"
    @unknown default:
      return "unknown"
    }
  }

  private func runtimeOptions(from call: FlutterMethodCall) -> CoreMlNemotronRuntimeOptions {
    CoreMlNemotronRuntimeOptions(
      language: stringArgument("language", from: call) ?? "auto",
      audioChunkDurationMs: intArgument("chunkDurationMs", from: call) ?? 320,
      modelChunkMs: intArgument("modelChunkMs", from: call) ?? 2240,
      autoDownloadModel: boolArgument("autoDownloadModel", from: call) ?? false,
      endpointMinSpeechMs: intArgument("endpointMinSpeechMs", from: call) ?? 600,
      endpointSilenceMs: intArgument("endpointSilenceMs", from: call) ?? 900,
      endpointSpeechThresholdRms:
        doubleArgument("endpointSpeechThresholdRms", from: call) ?? 0.006
    )
  }

  private func stringArgument(_ name: String, from call: FlutterMethodCall) -> String? {
    let arguments = call.arguments as? [String: Any]
    return arguments?[name] as? String
  }

  private func intArgument(_ name: String, from call: FlutterMethodCall) -> Int? {
    let arguments = call.arguments as? [String: Any]
    return arguments?[name] as? Int
  }

  private func boolArgument(_ name: String, from call: FlutterMethodCall) -> Bool? {
    let arguments = call.arguments as? [String: Any]
    return arguments?[name] as? Bool
  }

  private func doubleArgument(_ name: String, from call: FlutterMethodCall) -> Double? {
    let arguments = call.arguments as? [String: Any]
    if let value = arguments?[name] as? Double {
      return value
    }
    if let value = arguments?[name] as? NSNumber {
      return value.doubleValue
    }
    return nil
  }

  private func errorCode(from error: Error, fallback: String) -> String {
    let nsError = error as NSError
    return nsError.userInfo["code"] as? String ?? fallback
  }

  private func flutterError(code: String, message: String) -> FlutterError {
    FlutterError(
      code: code,
      message: message,
      details: availabilityPayload()
    )
  }
}
