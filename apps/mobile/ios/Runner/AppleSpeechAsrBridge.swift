import AVFoundation
import Flutter
import Speech

final class AppleSpeechAsrBridge: NSObject, FlutterStreamHandler {
  private let coordinator: AudioSessionCoordinator
  private var sink: FlutterEventSink?
  private var session: AnyObject?
  private var lastDiagnostics: [String: Any]?
  private var preparationTask: Task<Void, Error>?
  private var preparationID: String?
  private var preparationProgress: Progress?
  private var onlineEndpointSession: AnyObject?

  init(coordinator: AudioSessionCoordinator) { self.coordinator = coordinator }

  func register(messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name: "translation_mobile/apple_speech_asr", binaryMessenger: messenger)
      .setMethodCallHandler { [weak self] call, result in
        Task { @MainActor in await self?.handle(call, result: result) }
      }
    FlutterEventChannel(name: "translation_mobile/apple_speech_asr/events", binaryMessenger: messenger)
      .setStreamHandler(self)
  }
  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    sink = events; return nil
  }
  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    sink = nil
    let cancelledSession = session
    Task { @MainActor in
      if #available(iOS 26.0, *), let current = cancelledSession as? AppleSpeechSession {
        current.invalidate()
        if self.session === current { self.session = nil }
      }
    }
    return nil
  }

  @available(iOS 17.0, *)
  @MainActor
  private func handleOnlineEndpoint(_ call: FlutterMethodCall, result: @escaping FlutterResult) async throws {
    let args = call.arguments as? [String: Any] ?? [:]
    guard let id = args["requestId"] as? String, !id.isEmpty, id.count <= 120 else { throw AppleSpeechFailure.invalidConfiguration }
    switch call.method {
    case "endpoint.start":
      guard session == nil, preparationTask == nil, onlineEndpointSession == nil,
        let rate = args["sampleRate"] as? Int else { throw AppleSpeechFailure.busy }
      let current = try AppleOnlineEndpointSession(id: id, sampleRate: rate, configuration: AppleSpeechConfiguration(arguments: args)); onlineEndpointSession = current
      do { try await current.prepare() } catch { if onlineEndpointSession === current { onlineEndpointSession = nil }; current.invalidate(); throw error }
      guard onlineEndpointSession === current else { throw AppleSpeechFailure.cancelled }
      result(["requestId": id, "ready": true, "provider": "fluidaudio_silero"])
    case "endpoint.process":
      guard let current = onlineEndpointSession as? AppleOnlineEndpointSession, current.id == id,
        let sequence = args["sequence"] as? Int, let data = args["pcm"] as? FlutterStandardTypedData else { throw AppleSpeechFailure.invalidConfiguration }
      let boundary = try await current.accept(data: data.data, sequence: sequence)
      guard onlineEndpointSession === current else { throw AppleSpeechFailure.cancelled }
      result(["requestId": id, "sequence": sequence, "boundary": boundary])
    case "endpoint.stop":
      if let current = onlineEndpointSession as? AppleOnlineEndpointSession, current.id == id { current.invalidate(); onlineEndpointSession = nil }
      result(nil)
    default: result(FlutterMethodNotImplemented)
    }
  }

  @MainActor
  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) async {
    if call.method.hasPrefix("endpoint.") {
      guard #available(iOS 17.0, *) else { result(FlutterError(code: "ios_17_required", message: "Online VAD requires iOS 17", details: nil)); return }
      do { try await handleOnlineEndpoint(call, result: result) }
      catch { result(FlutterError(code: "online_endpoint_unavailable", message: error.localizedDescription, details: nil)) }
      return
    }

    guard #available(iOS 26.0, *) else {
      if call.method == "isAvailable" {
        result(["canStart": false, "reason": "ios_26_required"])
      } else { result(FlutterError(code: "ios_26_required", message: "Apple ASR requires iOS 26", details: nil)) }
      return
    }
    let args = call.arguments as? [String: Any] ?? [:]
    let language = args["language"] as? String ?? "auto"
    do {
      let input: AppleSpeechPrerecordedInput?
      if ["isAvailable", "prepare", "requestPermission", "start"].contains(call.method) {
        input = try prerecordedInput(arguments: args)
      } else { input = nil }
      switch call.method {
      case "isAvailable":
        let configuration = try AppleSpeechConfiguration(arguments: args)
        var payload = await AppleSpeechResources.availability(language: language,
          configuration: configuration, requiresMicrophone: input == nil)
        payload["inputKind"] = input == nil ? "microphone" : "prerecorded"
        if preparationTask != nil {
          payload["canStart"] = false; payload["reason"] = "resource_preparation_busy"
          payload["canPrepareLocally"] = false
        }
        result(payload)
      case "requestPermission":
        var mic = true
        if input == nil {
          mic = await withCheckedContinuation { c in AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) } }
        }
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        guard mic, speech == .authorized else { throw NSError(domain: "permission_denied", code: 1) }
        result(nil)
      case "prepare":
        try await prepareResources(language: language, arguments: args)
        result(nil)
      case "cancelPreparation":
        let id = try validatedResourceRequestID(args)
        if preparationID == id {
          preparationTask?.cancel(); preparationProgress?.cancel()
        }
        result(nil)
      case "start":
        guard session == nil, preparationTask == nil, onlineEndpointSession == nil else { throw AppleSpeechFailure.busy }
        guard let captureId = args["captureId"] as? String, !captureId.isEmpty,
              let policyKey = args["languagePolicyKey"] as? String, !policyKey.isEmpty else {
          throw NSError(domain: "invalid_asr_start_metadata", code: 1)
        }
        let configuration = try AppleSpeechConfiguration(arguments: args)
        let current = AppleSpeechSession(coordinator: coordinator) { [weak self] event in self?.sink?(event) }
        #if WUJIE_APPLE_FILE_PROBE
        if let input { try current.usePrerecordedInput(input) }
        #endif
        lastDiagnostics = nil
        session = current
        do { try await current.start(language: language,
          download: args["autoDownloadModel"] as? Bool == true,
          captureId: captureId, languagePolicyKey: policyKey, configuration: configuration) }
        catch { current.invalidate(); if session === current { session = nil }; throw error }
        result(nil)
      case "stop":
        if let current = session as? AppleSpeechSession {
          do { try await current.stop() }
          catch { lastDiagnostics = current.diagnostics(); if session === current { session = nil }; throw error }
          lastDiagnostics = current.diagnostics()
          if session === current { session = nil }
        }
        result(nil)
      case "diagnostics":
        result((session as? AppleSpeechSession)?.diagnostics() ?? lastDiagnostics ?? ["running": false])
      default: result(FlutterMethodNotImplemented)
      }
    } catch {
      let resourceFailure = error as? AppleSpeechResourceReadinessError
      let registrationFailure = error as? AppleSpeechResourceRegistrationError
      let code = (registrationFailure == nil ? nil : "resource_local_registration_failed") ??
        resourceFailure?.snapshot.reason ?? (error as? AppleSpeechFailure)?.rawValue ??
        (error as? AppleSpeechPrerecordedError)?.rawValue ??
        (["prepare", "cancelPreparation"].contains(call.method)
         ? localResourcePreparationErrorCode(error) : "apple_asr_failed")
      if call.method == "isAvailable" {
        result(["canStart": false, "reason": code,
                "message": error.localizedDescription, "qualityQualified": false])
        return
      }
      result(FlutterError(code: code,
                          message: error.localizedDescription,
                          details: registrationFailure?.payload ?? resourceFailure?.snapshot.payload))
    }
  }

  @available(iOS 26.0, *)
  @MainActor
  private func prepareResources(language: String, arguments args: [String: Any]) async throws {
    guard session == nil, preparationTask == nil else { throw LocalResourcePreparationError.busy }
    let download = args["autoDownloadModel"] as? Bool == true
    let id = download ? try authorizedResourceRequestID(args) : UUID().uuidString
    _ = try AppleSpeechConfiguration(arguments: args)
    preparationID = id
    let task = Task { @MainActor [self] in
      try Task.checkCancellation()
      _ = try AppleSpeechResources.sileroURL()
      let locale = try await AppleSpeechResources.locale(language)
      try Task.checkCancellation()
      let transcriber = SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
      var observed = await AppleSpeechResources.snapshot(language: language,
        locale: locale, transcriber: transcriber, stage: "prepare_before")
      try Task.checkCancellation()
      if !download, observed.canPrepareLocally {
        // Register only an already-installed locale for this App. This does not
        // create an installation request or release any existing reservation.
        do { _ = try await AssetInventory.reserve(locale: locale) }
        catch {
          if error is CancellationError || Task.isCancelled { throw CancellationError() }
          let underlying = error as NSError
          throw AppleSpeechResourceRegistrationError(snapshot: observed,
            domain: underlying.domain, code: underlying.code, message: underlying.localizedDescription)
        }
        try Task.checkCancellation()
        observed = await AppleSpeechResources.snapshot(language: language,
          locale: locale, transcriber: transcriber, stage: "prepare_after_local_reservation")
        try Task.checkCancellation()
      }
      if !observed.canStart {
        guard download, ["supported", "downloading"].contains(observed.assetStatus) else {
          throw AppleSpeechResourceReadinessError(snapshot: observed)
        }
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
          try Task.checkCancellation()
          preparationProgress = request.progress
          try await request.downloadAndInstall()
        }
      }
      try Task.checkCancellation()
      let final = await AppleSpeechResources.snapshot(language: language,
        locale: locale, transcriber: transcriber, stage: "prepare_after")
      try Task.checkCancellation()
      try final.requireReady()
      try Task.checkCancellation()
    }
    preparationTask = task
    defer {
      if preparationID == id { preparationID = nil; preparationTask = nil; preparationProgress = nil }
    }
    do {
      try await appleSpeechWithDeadline(nanoseconds: 300_000_000_000) { try await task.value }
    } catch {
      task.cancel(); preparationProgress?.cancel()
      if error as? AppleSpeechFailure == .stopTimeout { throw LocalResourcePreparationError.timeout }
      throw error
    }
  }

  private func prerecordedInput(arguments args: [String: Any]) throws -> AppleSpeechPrerecordedInput? {
    if let kind = args["inputKind"], !(kind is String) { throw AppleSpeechPrerecordedError.invalid }
    let microphone = try AppleSpeechInputPolicy.requiresMicrophone(kind: args["inputKind"] as? String,
      hasPrerecordedInput: args.keys.contains("prerecordedInput"))
    if microphone { return nil }
    guard args["autoDownloadModel"] as? Bool != true,
          let input = args["prerecordedInput"] as? [String: Any],
          Set(input.keys) == Set(["wav", "sha256"]),
          let bytes = input["wav"] as? FlutterStandardTypedData,
          let hash = input["sha256"] as? String else { throw AppleSpeechPrerecordedError.invalid }
    return try AppleSpeechPrerecordedInput(wav: bytes.data, expectedSHA256: hash)
  }
}
