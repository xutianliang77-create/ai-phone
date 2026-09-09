import AVFoundation
import CoreML
import Foundation
import Speech
#if canImport(FluidAudio)
import FluidAudio
#endif

@available(iOS 26.0, *)
@MainActor
final class AppleSpeechSession {
  let id = UUID().uuidString
  private let coordinator: AudioSessionCoordinator
  private var source: CoreMlNemotronAudioInput?
  private let queue = AppleSpeechInputQueue()
  private let emit: ([String: Any]) -> Void
  private var open = true
  private var stopping = false
  private var stopTask: Task<Void, Error>?
  private var analyzer: SpeechAnalyzer?
  private var feed: AsyncStream<AnalyzerInput>.Continuation?
  private var consumer: Task<Void, Error>?
  private var reader: Task<Void, Error>?
  private var analysis: Task<Void, Error>?
  private var fedSamples = 0
  private var language = ""
  private var resolvedLocale = ""
  private var captureId = ""
  private var languagePolicyKey = ""
  private var resultRevision = 0
  private var speechActivity = AppleSpeechActivityGate()
  private var pendingTranscripts: [Int: (start: Int, end: Int, payload: [String: Any])] = [:]
  private var hypotheses = AppleSpeechHypothesisTracker()
  private var failed: Error?
  private var configuration = try! AppleSpeechConfiguration()
  private var endpoint = CoreMlNemotronEndpointDetector(minSpeechMs: 96, endpointSilenceMs: 640)
  #if WUJIE_APPLE_FILE_PROBE
  private var fileSamples: [Float]?
  private var fileProducer: Task<Void, Error>?
  private var fileProducerLagMs = 0.0
  private var fileSHA256: String?
  #endif
  #if canImport(FluidAudio)
  private var vad: VadManager?
  private var state = VadStreamState.initial()
  #endif

  init(coordinator: AudioSessionCoordinator, emit: @escaping ([String: Any]) -> Void) {
    self.coordinator = coordinator
    self.emit = emit
  }

  private func requireStarting() throws {
    guard open, !stopping, !Task.isCancelled else { throw AppleSpeechFailure.cancelled }
  }

  func start(language: String, download: Bool, captureId: String,
             languagePolicyKey: String,
             configuration: AppleSpeechConfiguration = try! AppleSpeechConfiguration()) async throws {
    self.language = language
    self.captureId = captureId
    self.languagePolicyKey = languagePolicyKey
    self.configuration = configuration
    endpoint = CoreMlNemotronEndpointDetector(vadThreshold: configuration.threshold,
      vadNegativeThreshold: configuration.negativeThreshold,
      minSpeechMs: configuration.minSpeechMs, endpointSilenceMs: configuration.silenceMs)
    speechActivity = AppleSpeechActivityGate(preRollSamples: configuration.preRollSamples,
      evidenceWaitSamples: configuration.preRollSamples + configuration.minSpeechSamples + 4096)
    #if canImport(FluidAudio)
    let locale = try await AppleSpeechResources.locale(language)
    resolvedLocale = locale.identifier
    try requireStarting()
    let transcriber = SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
    let resources = await AppleSpeechResources.snapshot(language: language,
      locale: locale, transcriber: transcriber, stage: "start")
    // Resource preparation is explicit; capture must never initiate a download.
    try resources.requireReady()
    try requireStarting()
    let modelConfiguration = MLModelConfiguration(); modelConfiguration.computeUnits = .cpuAndNeuralEngine
    let model = try MLModel(contentsOf: AppleSpeechResources.sileroURL(), configuration: modelConfiguration)
    vad = VadManager(config: VadConfig(defaultThreshold: Float(configuration.threshold), computeUnits: .cpuAndNeuralEngine), vadModel: model)
    let analyzer = SpeechAnalyzer(modules: [transcriber], options: .init(priority: .userInitiated, modelRetention: .whileInUse))
    self.analyzer = analyzer
    let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    try await analyzer.prepareToAnalyze(in: format)
    try requireStarting()
    let pair = AsyncStream<AnalyzerInput>.makeStream(bufferingPolicy: .bufferingOldest(128))
    feed = pair.continuation
    reader = Task { [self] in
      do {
        for try await result in transcriber.results {
          guard open else { break }
          let start = CMTimeGetSeconds(result.range.start)
          let end = CMTimeGetSeconds(result.range.end)
          guard start.isFinite, end.isFinite, start >= 0, end >= start,
                end <= Double(fedSamples) / 16000 + 0.1 else { continue }
          let text = String(result.text.characters)
          let startSample = Int((start * 16000).rounded()), endSample = Int((end * 16000).rounded())
          let watermark = CMTimeGetSeconds(result.resultsFinalizationTime)
          let updates = try hypotheses.accept(text: text, start: startSample, end: endSample,
            final: result.isFinal, finalizedThrough: watermark.isFinite && watermark >= 0
              ? min(fedSamples, Int((watermark * 16000).rounded())) : 0)
          try enqueueSpeechResults(updates)
        }
      } catch { fail(error); throw error }
    }
    analysis = Task { [self] in
      do { try await analyzer.start(inputSequence: pair.stream) }
      catch { fail(error); throw error }
    }
    consumer = Task { [self] in
      var pending: [Float] = []
      var offset = 0
      do {
        for try await packet in queue.stream {
          guard open else { throw AppleSpeechFailure.cancelled }
          let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(packet.samples.count))!
          pcm.frameLength = AVAudioFrameCount(packet.samples.count)
          for i in packet.samples.indices {
            pcm.int16ChannelData![0][i] = Int16(max(-32768, min(32767, Int((packet.samples[i] * 32768).rounded()))))
          }
          guard case .enqueued = pair.continuation.yield(AnalyzerInput(
            buffer: pcm, bufferStartTime: CMTime(value: Int64(packet.offset), timescale: 16000))) else {
            throw AppleSpeechFailure.queueOverflow
          }
          fedSamples += packet.samples.count
          pending.append(contentsOf: packet.samples)
          while pending.count >= 4096 {
            try await processVad(Array(pending.prefix(4096)), offset: offset, valid: 4096)
            pending.removeFirst(4096); offset += 4096
          }
        }
        if !pending.isEmpty {
          let valid = pending.count
          pending += Array(repeating: 0, count: 4096 - valid)
          try await processVad(pending, offset: offset, valid: valid)
        }
        speechActivity.finish()
        flushTranscriptsWithSpeechEvidence()
        pair.continuation.finish()
      } catch { pair.continuation.finish(); fail(error); throw error }
    }
    #if WUJIE_APPLE_FILE_PROBE
    if let samples = fileSamples {
      fileProducer = Task { @MainActor [self] in
        do {
          let begin = ProcessInfo.processInfo.systemUptime
          let chunkSamples = configuration.chunkDurationMs * 16
          for offset in stride(from: 0, to: samples.count, by: chunkSamples) {
            try requireStarting()
            let expected = begin + Double(offset) / 16000
            let delay = expected - ProcessInfo.processInfo.systemUptime
            if delay > 0 { try await Task.sleep(nanoseconds: UInt64(delay * 1e9)) }
            try requireStarting()
            fileProducerLagMs = max(fileProducerLagMs, (ProcessInfo.processInfo.systemUptime - expected) * 1000)
            if fileProducerLagMs > 500 { throw NSError(domain: "file_audio_schedule_gap", code: 1) }
            queue.append(Array(samples[offset..<min(offset + chunkSamples, samples.count)]))
          }
          let tailDelay = begin + Double(samples.count) / 16000 - ProcessInfo.processInfo.systemUptime
          if tailDelay > 0 { try await Task.sleep(nanoseconds: UInt64(tailDelay * 1e9)) }
          try requireStarting()
          queue.finish()
          emit(["type": "input.completed", "sessionId": id, "captureId": captureId,
                "languagePolicyKey": languagePolicyKey, "inputKind": "prerecorded",
                "sha256": fileSHA256 ?? "", "samples": samples.count,
                "maxProducerLagMs": fileProducerLagMs])
        } catch {
          if open && !stopping { fail(error) }
          throw error
        }
      }
      return
    }
    #endif
    let source = CoreMlNemotronAudioInput(audioSessionCoordinator: coordinator, owner: "apple_speech_asr")
    self.source = source
    try source.start(chunkDurationMs: configuration.chunkDurationMs, onRuntimeError: { [weak self] code, message in
      Task { @MainActor in self?.fail(NSError(domain: code, code: 1, userInfo: [NSLocalizedDescriptionKey: message])) }
    }, onChunk: { [queue] in queue.append($0) })
    #else
    throw AppleSpeechFailure.sileroMissing
    #endif
  }

  private func processVad(_ frame: [Float], offset: Int, valid: Int) async throws {
    #if canImport(FluidAudio)
    guard open, let vad else { throw AppleSpeechFailure.cancelled }
    let result = try await vad.processStreamingChunk(frame, state: state, config: .init(
      minSpeechDuration: Double(configuration.minSpeechMs) / 1000,
      minSilenceDuration: Double(configuration.silenceMs) / 1000, speechPadding: 0,
      silenceThresholdForSplit: Float(configuration.negativeThreshold),
      negativeThreshold: Float(configuration.negativeThreshold),
      negativeThresholdOffset: Float(configuration.threshold - configuration.negativeThreshold)))
    guard open else { throw AppleSpeechFailure.cancelled }
    state = result.state
    // FluidAudio's streaming events do not enforce minSpeechDuration. Reuse the
    // original 1.0 endpoint detector as the sole product boundary authority.
    let boundary = endpoint.acceptVadFrame(probability: Double(result.probability),
      samples: Array(frame.prefix(valid)), provider: "fluidaudio_silero")
    let speechEvent: (start: Bool, sample: Int)? = boundary.speechStarted
      ? (true, max(0, offset + valid - boundary.confirmedSpeechSamples))
      : boundary.shouldFinalize ? (false, max(0, offset + valid - boundary.trailingSilenceSamples)) : nil
    speechActivity.advance(through: offset + valid, speechEvent: speechEvent)
    flushTranscriptsWithSpeechEvidence()
    if let event = speechEvent {
      let end = event.sample
      emit(["type": "vad.boundary", "sessionId": id,
            "captureId": captureId, "languagePolicyKey": languagePolicyKey,
            "speechStarted": event.start, "sample": end,
            "preRollSamples": configuration.preRollSamples,
            "configurationFingerprint": configuration.fingerprint])
      // Keep PCM continuous; finalized text remains the sole downstream commit.
      if !event.start, !stopping, let analyzer {
        try await appleSpeechWithDeadline {
          try await analyzer.finalize(through: CMTime(value: Int64(end), timescale: 16000))
        }
      }
    }
    #endif
  }

  func diagnostics() -> [String: Any] {
    let counts = queue.snapshot()
    var result: [String: Any] = ["effectiveParameters": configuration.parameters,
     "sourceLanguage": language, "resolvedLocale": resolvedLocale,
     "configurationFingerprint": configuration.fingerprint,
     "endpoint": endpoint.payload(), "capture": source?.payload() ?? ["running": false],
     "running": open && !stopping, "microphoneCreated": source != nil,
     "receivedSamples": counts.received, "acceptedSamples": counts.accepted,
     "fedSamples": fedSamples, "overflow": counts.overflow, "inputKind": "microphone"]
    #if WUJIE_APPLE_FILE_PROBE
    if let samples = fileSamples {
      result.merge(["inputKind": "prerecorded", "expectedSamples": samples.count,
        "sha256": fileSHA256 ?? "", "maxProducerLagMs": fileProducerLagMs]) { _, new in new }
    }
    #endif
    return result
  }

  func stop() async throws {
    if let stopTask { return try await stopTask.value }
    stopping = true
    #if WUJIE_APPLE_FILE_PROBE
    fileProducer?.cancel()
    #endif
    queue.finish(tail: source?.stop(flushPending: true) ?? [])
    let task = Task { @MainActor [self] in
      do {
        try await appleSpeechWithDeadline { [consumer, analysis, reader, analyzer] in
          try await consumer?.value
          try await analyzer?.finalizeAndFinishThroughEndOfInput()
          try await analysis?.value
          try await reader?.value
        }
        if let failed { throw failed }
        let counts = queue.snapshot()
        guard !counts.overflow, counts.accepted == fedSamples else { throw AppleSpeechFailure.queueOverflow }
        try enqueueSpeechResults(hypotheses.finalize(through: fedSamples))
        open = false
      } catch { invalidate(); throw error }
    }
    stopTask = task
    try await task.value
  }

  func invalidate() {
    open = false; stopping = true
    _ = source?.stop(); queue.finish(); feed?.finish()
    consumer?.cancel(); analysis?.cancel(); reader?.cancel()
    #if WUJIE_APPLE_FILE_PROBE
    fileProducer?.cancel()
    #endif
    pendingTranscripts.removeAll()
    if let analyzer { Task { await analyzer.cancelAndFinishNow() } }
  }

  #if WUJIE_APPLE_FILE_PROBE
  func usePrerecordedInput(_ input: AppleSpeechPrerecordedInput) throws {
    guard analyzer == nil, source == nil, !stopping else { throw AppleSpeechFailure.busy }
    fileSamples = input.samples
    fileSHA256 = input.sha256
  }
  #endif

  private func enqueueSpeechResults(_ updates: [AppleSpeechHypothesis]) throws {
    for value in updates {
      resultRevision += 1
      let payload = value.payload(sessionId: id, captureId: captureId,
        policy: languagePolicyKey, language: language, revision: resultRevision)
      if value.retracted { pendingTranscripts.removeValue(forKey: value.key); emit(payload); continue }
      pendingTranscripts[value.key] = (value.start, value.end, payload)
      #if WUJIE_APPLE_FILE_PROBE
      if fileSamples != nil {
        var raw = payload; raw["type"] = "probe.raw_segment"
        if value.final { raw["textLanguageObservation"] = AppleTextLanguageObservation.analyze(value.text) }
        emit(raw)
      }
      #endif
    }
    flushTranscriptsWithSpeechEvidence()
    if pendingTranscripts.count > 128 { throw AppleSpeechFailure.queueOverflow }
  }

  private func flushTranscriptsWithSpeechEvidence() {
    guard open else { return }
    for start in pendingTranscripts.keys.sorted() {
      guard let pending = pendingTranscripts[start] else { continue }
      switch speechActivity.decision(start: pending.start, end: pending.end) {
      case .wait: continue
      case .accept:
        pendingTranscripts.removeValue(forKey: start)
        emit(pending.payload)
      case .reject:
        pendingTranscripts.removeValue(forKey: start)
        var retracted = pending.payload
        resultRevision += 1; retracted["revision"] = resultRevision
        retracted["text"] = ""; retracted["isFinal"] = false; retracted["isRetraction"] = true
        emit(retracted)
      }
    }
  }

  private func fail(_ error: Error) {
    guard open else { return }
    failed = error
    emit(["type": "runtime.error", "code": "apple_asr_runtime_error",
          "message": error.localizedDescription, "sessionId": id,
          "captureId": captureId, "languagePolicyKey": languagePolicyKey])
    invalidate()
  }
}
