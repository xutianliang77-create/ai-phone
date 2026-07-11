import Foundation

#if canImport(FluidAudio)
import FluidAudio
#endif

final class CoreMlNemotronFluidAudioAdapter {
  typealias SegmentEmitter = ([String: Any]) -> Void

  private let modelResolver: CoreMlNemotronModelResolver
  private let audioInput = CoreMlNemotronAudioInput()
  private var endpointDetector = CoreMlNemotronEndpointDetector()

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

  init(modelStore: CoreMlNemotronModelStore) {
    self.modelResolver = CoreMlNemotronModelResolver(modelStore: modelStore)
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
      "endpoint": endpointDetector.payload()
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
    let languageCode = normalizedLanguage(options.language)
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
      self?.emit(text: text, language: languageCode, isFinal: false)
    }

    self.manager = manager
    self.processingTask = nil
    self.processingError = nil
    self.lastProcessingError = nil
    self.running = true
    self.segmentId = UUID().uuidString
    self.language = languageCode
    self.lastPartialText = ""
    self.emitSegment = emitSegment
    self.endpointDetector = CoreMlNemotronEndpointDetector(
      speechThresholdRms: options.endpointSpeechThresholdRms,
      minSpeechMs: options.endpointMinSpeechMs,
      endpointSilenceMs: options.endpointSilenceMs
    )
    self.endpointDetector.reset()

    do {
      try audioInput.start(chunkDurationMs: options.audioChunkDurationMs) { [weak self] samples in
        self?.enqueue(samples: samples)
      }
    } catch {
      self.running = false
      _ = self.audioInput.stop()
      await manager.cleanup()
      self.manager = nil
      self.preparedKey = nil
      self.emitSegment = nil
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
    let languageCode = normalizedLanguage(options.language)
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
    manager = preparedManager
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
    }
    processingTask = nil
    emitSegment = nil
    lastPartialText = ""
    endpointDetector.reset()
    if let stopError {
      throw stopError
    }
    #else
    return
    #endif
  }

  #if canImport(FluidAudio)
  private func enqueue(samples: [Float]) {
    let endpoint = endpointDetector.accept(samples: samples)
    let previousTask = processingTask
    processingTask = Task { [weak self, previousTask, endpoint] in
      await previousTask?.value
      guard let self, self.running, let manager = self.manager else { return }
      do {
        _ = try await manager.process(samples: samples)
        if endpoint.shouldFinalize {
          try await self.finalizeCurrentSegment(manager: manager)
          await manager.reset()
        }
      } catch {
        self.processingError = error
        self.lastProcessingError = error
      }
    }
  }

  private func finalizeCurrentSegment(
    manager: StreamingNemotronMultilingualAsrManager
  ) async throws {
    let text = try await manager.finish()
    let detectedLanguage = await manager.detectedLanguage() ?? language
    emit(text: text, language: detectedLanguage, isFinal: true)
    rotateSegment()
  }
  #endif

  private func emit(text: String, language: String, isFinal: Bool) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    if !isFinal && trimmed == lastPartialText { return }
    if !isFinal {
      lastPartialText = trimmed
    }
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
      String(options.autoDownloadModel)
    ].joined(separator: "|")
  }

  private func normalizedLanguage(_ rawLanguage: String) -> String {
    switch rawLanguage.lowercased() {
    case "zh", "zh-cn", "cmn", "cmn-hans-cn":
      return "zh-CN"
    case "en", "en-us":
      return "en-US"
    case "auto":
      return "auto"
    default:
      return rawLanguage
    }
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
