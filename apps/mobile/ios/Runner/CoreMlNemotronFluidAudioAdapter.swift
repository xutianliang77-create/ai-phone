import Foundation

#if canImport(FluidAudio)
import FluidAudio
#endif

final class CoreMlNemotronFluidAudioAdapter {
  typealias SegmentEmitter = ([String: Any]) -> Void

  private let modelResolver: CoreMlNemotronModelResolver
  private let audioInput: CoreMlNemotronAudioInput
  private let diagnosticRecorder = CoreMlNemotronDiagnosticRecorder()
  private let playbackEchoState = CoreMlNemotronPlaybackEchoState()
  private var vadPipeline: CoreMlNemotronFluidVad?
  private var languageRouter: CoreMlNemotronLanguageRouter?

  #if canImport(FluidAudio)
  private var manager: StreamingNemotronMultilingualAsrManager?
  private var processingTask: Task<Void, Never>?
  private var processingError: Error?
  private var lastProcessingError: Error?
  private var preparedKey: String?
  #endif

  private var running = false
  private var segmentId = UUID().uuidString
  private var language = "auto"
  private var lastPartialText = ""
  private var emitSegment: SegmentEmitter?

  init(
    modelStore: CoreMlNemotronModelStore,
    audioSessionCoordinator: AudioSessionCoordinator
  ) {
    self.modelResolver = CoreMlNemotronModelResolver(modelStore: modelStore)
    self.audioInput = CoreMlNemotronAudioInput(
      audioSessionCoordinator: audioSessionCoordinator
    )
  }

  var runtimeAvailable: Bool {
    #if canImport(FluidAudio)
    return true
    #else
    return false
    #endif
  }

  var preparedModelReady: Bool {
    #if canImport(FluidAudio)
    return manager != nil
    #else
    return false
    #endif
  }

  func payload() -> [String: Any] {
    var payload: [String: Any] = [
      "runtimeAvailable": runtimeAvailable,
      "prepared": preparedModelReady,
      "running": running,
      "model": modelResolver.payload(),
      "audio": audioInput.payload(),
      "vad": vadPipeline?.payload() ?? ["activeProvider": "not_prepared"],
      "endpoint": vadPipeline?.payload()["endpoint"] ?? [:],
      "languageRouting":
        languageRouter?.payload() ?? ["mode": "not_started"],
      "playbackEcho": playbackEchoState.payload(),
      "diagnosticCapture": diagnosticRecorder.payload()
    ]
    #if canImport(FluidAudio)
    let retainedProcessingError = processingError ?? lastProcessingError
    if let retainedProcessingError {
      payload["processingError"] = retainedProcessingError.localizedDescription
    }
    #endif
    return payload
  }

  func start(
    options: CoreMlNemotronRuntimeOptions,
    emitSegment: @escaping SegmentEmitter
  ) async throws {
    #if canImport(FluidAudio)
    if running {
      try await stop()
    }
    playbackEchoState.reset()
    let router = CoreMlNemotronLanguageRouter(
      language: options.language,
      turnPolicy: options.turnRoutingPolicy
    )
    let languageCode = router.currentPrompt
    let key = preparationKey(options: options, language: languageCode)
    if manager == nil || preparedKey != key {
      try await prepare(options: options)
    }
    guard let manager else {
      throw adapterError(
        code: "model_prepare_failed",
        message: "Nemotron manager was not prepared"
      )
    }
    await manager.setLanguage(languageCode)
    await manager.setPartialCallback { [weak self] text in
      guard let self else { return }
      self.emit(text: text, language: self.language, isFinal: false)
    }

    self.manager = manager
    self.processingTask = nil
    self.processingError = nil
    self.lastProcessingError = nil
    self.running = true
    self.segmentId = UUID().uuidString
    self.language = languageCode
    self.languageRouter = router
    self.lastPartialText = ""
    self.emitSegment = emitSegment
    if self.vadPipeline == nil {
      let pipeline = CoreMlNemotronFluidVad(
        options: options,
        playbackEchoState: playbackEchoState
      )
      await pipeline.prepare()
      self.vadPipeline = pipeline
    }
    await self.vadPipeline?.resetSegment()
    diagnosticRecorder.start(
      enabled: options.diagnosticCaptureEnabled,
      sessionId: options.diagnosticSessionId,
      configuration: diagnosticConfiguration(
        options: options,
        prompt: languageCode
      ),
      modelDirectory: modelResolver.payload()["lastResolvedPath"] as? String
    )

    do {
      try audioInput.start(
        chunkDurationMs: options.audioChunkDurationMs,
        onRuntimeError: { [weak self] code, message in
          self?.handleRuntimeError(code: code, message: message)
        },
        onChunk: { [weak self] samples in
          guard let self else { return }
          self.diagnosticRecorder.appendAudio(samples)
          self.enqueue(samples: samples)
        }
      )
    } catch {
      self.running = false
      _ = self.audioInput.stop()
      await manager.cleanup()
      self.manager = nil
      self.preparedKey = nil
      self.emitSegment = nil
      self.diagnosticRecorder.record(
        type: "session.start_failed",
        payload: ["message": error.localizedDescription]
      )
      self.diagnosticRecorder.finish()
      throw error
    }
    #else
    throw adapterError(
      code: "fluidaudio_unavailable",
      message: "FluidAudio Swift package is not linked into the iOS target"
    )
    #endif
  }

  func prepare(options: CoreMlNemotronRuntimeOptions) async throws {
    #if canImport(FluidAudio)
    if running { return }
    let languageCode = CoreMlNemotronLanguageRouter(
      language: options.language,
      turnPolicy: options.turnRoutingPolicy
    ).currentPrompt
    let key = preparationKey(options: options, language: languageCode)
    if manager != nil && preparedKey == key { return }
    if let manager {
      await manager.cleanup()
    }
    let modelDirectory = try await modelResolver.resolve(
      language: languageCode,
      modelChunkMs: options.modelChunkMs,
      autoDownload: options.autoDownloadModel
    )
    let preparedManager = StreamingNemotronMultilingualAsrManager()
    try await preparedManager.loadModels(from: modelDirectory)
    await preparedManager.setLanguage(languageCode)
    let preparedVad = CoreMlNemotronFluidVad(
      options: options,
      playbackEchoState: playbackEchoState
    )
    await preparedVad.prepare()
    manager = preparedManager
    vadPipeline = preparedVad
    preparedKey = key
    language = languageCode
    lastProcessingError = nil
    #else
    throw adapterError(
      code: "fluidaudio_unavailable",
      message: "FluidAudio Swift package is not linked into the iOS target"
    )
    #endif
  }

  func stop(keepPrepared: Bool = false) async throws {
    #if canImport(FluidAudio)
    guard running || manager != nil else { return }
    let wasRunning = running
    var stopError: Error?
    let tailSamples = audioInput.stop(flushPending: wasRunning)
    if wasRunning && !tailSamples.isEmpty {
      enqueue(samples: tailSamples)
    }
    if wasRunning {
      await processingTask?.value
    }
    running = false

    if let processingError {
      self.processingError = nil
      stopError = processingError
    }

    if let manager {
      if wasRunning && stopError == nil {
        do {
          try await finalizeCurrentSegment(manager: manager)
          if keepPrepared {
            await manager.reset()
          }
        } catch {
          stopError = error
        }
      }
      if !keepPrepared || stopError != nil {
        await manager.cleanup()
      }
    }

    if !keepPrepared || stopError != nil {
      manager = nil
      preparedKey = nil
      vadPipeline = nil
    }
    processingTask = nil
    emitSegment = nil
    lastPartialText = ""
    languageRouter = nil
    await vadPipeline?.resetSegment()
    diagnosticRecorder.finish()
    playbackEchoState.reset()
    if let stopError {
      throw stopError
    }
    #else
    return
    #endif
  }

  #if canImport(FluidAudio)
  private func enqueue(samples: [Float]) {
    let previousTask = processingTask
    processingTask = Task { [weak self, previousTask] in
      await previousTask?.value
      guard
        let self,
        self.running,
        let manager = self.manager,
        let vadPipeline = self.vadPipeline
      else { return }
      guard self.processingError == nil else { return }
      do {
        let decision = await vadPipeline.accept(samples: samples)
        for event in decision.diagnosticEvents {
          self.diagnosticRecorder.record(type: "vad.frame", payload: event)
        }
        if decision.speechStarted {
          self.diagnosticRecorder.record(
            type: "vad.speech_start",
            payload: [
              "forwardedSamples": decision.samplesToProcess.count,
              "provider": vadPipeline.payload()["activeProvider"] as Any,
              "bargeIn": decision.bargeIn
            ]
          )
        }
        if !decision.samplesToProcess.isEmpty {
          self.diagnosticRecorder.record(
            type: "asr.audio_forwarded",
            payload: ["samples": decision.samplesToProcess.count]
          )
          _ = try await manager.process(samples: decision.samplesToProcess)
        }
        if decision.shouldFinalize {
          self.diagnosticRecorder.record(
            type: "endpoint.finalize",
            payload: [
              "reason": decision.endpointReason ?? "unknown",
              "segmentId": self.segmentId
            ]
          )
          let final = try await self.finalizeCurrentSegment(manager: manager)
          await manager.reset()
          let nextLanguage = self.languageRouter?.routeAfterFinal(
            text: final.text,
            detectedLanguage: final.detectedLanguage
          ) ?? self.language
          self.language = nextLanguage
          await manager.setLanguage(nextLanguage)
          self.diagnosticRecorder.record(
            type: "language.route",
            payload: [
              "nextPrompt": nextLanguage,
              "routing": self.languageRouter?.payload() ?? [:]
            ]
          )
          await vadPipeline.resetSegment()
        }
      } catch {
        self.handleRuntimeError(
          code: "asr_processing_failed",
          message: error.localizedDescription
        )
      }
    }
  }

  private func handleRuntimeError(code: String, message: String) {
    guard processingError == nil else { return }
    let error = adapterError(code: code, message: message)
    processingError = error
    lastProcessingError = error
    diagnosticRecorder.record(
      type: "runtime.error",
      payload: ["code": code, "message": message]
    )
    emitSegment?([
      "type": "runtime.error",
      "code": code,
      "message": message
    ])
  }

  private func finalizeCurrentSegment(
    manager: StreamingNemotronMultilingualAsrManager
  ) async throws -> (text: String, detectedLanguage: String?) {
    let text = try await manager.finish()
    let detectedLanguage = await manager.detectedLanguage()
    emit(text: text, language: detectedLanguage ?? language, isFinal: true)
    rotateSegment()
    return (text, detectedLanguage)
  }
  #endif

  private func emit(text: String, language: String, isFinal: Bool) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    if !isFinal && trimmed == lastPartialText { return }
    if !isFinal {
      lastPartialText = trimmed
    }
    diagnosticRecorder.record(
      type: isFinal ? "asr.final" : "asr.partial",
      payload: [
        "segmentId": segmentId,
        "text": trimmed,
        "language": language
      ]
    )
    emitSegment?([
      "id": segmentId,
      "text": trimmed,
      "language": gatewayLanguageCode(language),
      "isFinal": isFinal
    ])
  }

  private func rotateSegment() {
    segmentId = UUID().uuidString
    lastPartialText = ""
  }

  private func preparationKey(
    options: CoreMlNemotronRuntimeOptions,
    language: String
  ) -> String {
    [
      language,
      String(options.modelChunkMs),
      String(options.autoDownloadModel),
      options.vadProvider,
      String(options.vadThreshold),
      String(options.vadNegativeThreshold),
      String(options.vadPreRollMs),
      options.turnRoutingPolicy,
      String(options.endpointMinSpeechMs),
      String(options.endpointSilenceMs)
    ].joined(separator: "|")
  }

  private func gatewayLanguageCode(_ rawLanguage: String) -> String {
    if rawLanguage.lowercased().hasPrefix("zh") {
      return "zh"
    }
    if rawLanguage.lowercased().hasPrefix("en") {
      return "en"
    }
    return rawLanguage
  }

  func recordDiagnosticEvent(type: String, payload: [String: Any]) {
    var recordedPayload = payload
    if type.hasPrefix("tts.") {
      let state = playbackEchoState.record(type: type, payload: payload)
      recordedPayload["nativePlaybackActive"] = state.playbackActive
      recordedPayload["nativeEchoTailActive"] = state.echoTailActive
      recordedPayload["nativeEchoProtectionActive"] =
        state.echoProtectionActive
      recordedPayload["nativeEchoTailRemainingMs"] = state.tailRemainingMs
    }
    diagnosticRecorder.record(type: type, payload: recordedPayload)
  }

  private func diagnosticConfiguration(
    options: CoreMlNemotronRuntimeOptions,
    prompt: String
  ) -> [String: Any] {
    [
      "asrModel": "nvidia/nemotron-asr-streaming-multilingual-0.6b",
      "modelChunkMs": options.modelChunkMs,
      "audioChunkDurationMs": options.audioChunkDurationMs,
      "configuredLanguage": options.language,
      "initialPrompt": prompt,
      "endpointMinSpeechMs": options.endpointMinSpeechMs,
      "endpointSilenceMs": options.endpointSilenceMs,
      "endpointSpeechThresholdRms": options.endpointSpeechThresholdRms,
      "vadProvider": options.vadProvider,
      "vadModel": "silero-vad-unified-256ms-v6.0.0",
      "vadThreshold": options.vadThreshold,
      "vadNegativeThreshold": options.vadNegativeThreshold,
      "vadPreRollMs": options.vadPreRollMs,
      "echoBargeInRmsThreshold": options.endpointSpeechThresholdRms,
      "echoTailMs": CoreMlNemotronPlaybackEchoState.tailMs,
      "turnRoutingPolicy": options.turnRoutingPolicy,
      "sampleRate": 16_000,
      "voiceProcessing": "apple_voice_processing_aec_ns",
      "agcEnabled": false
    ]
  }

  private func adapterError(code: String, message: String) -> NSError {
    NSError(
      domain: "CoreMlNemotronFluidAudioAdapter",
      code: 1,
      userInfo: [
        NSLocalizedDescriptionKey: message,
        "code": code
      ]
    )
  }
}
