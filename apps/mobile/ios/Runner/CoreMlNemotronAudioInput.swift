import AVFoundation

final class CoreMlNemotronAudioInput {
  private let audioSessionCoordinator: AudioSessionCoordinator
  private let audioSessionOwner: String
  private let engine = AVAudioEngine()
  private let queue = DispatchQueue(label: "translation_mobile.coreml_nemotron.audio")
  private var pendingSamples: [Float] = []
  private var running = false
  private var tapInstalled = false
  private var audioSessionActive = false
  private var audioSessionError: String?
  private var voiceProcessingAttempted = false
  private var lastVoiceProcessingEnabled = false
  private var lastVoiceProcessingAgcEnabled = false
  private var voiceProcessingError: String?
  private var bypassedBeforeConfiguration: Bool?
  private var engineInvalidations = 0
  private var lastChunkSamples = 0
  private var lastInputSampleRate = 0
  private var lastInputChannels = 0
  private var totalInputBuffers = 0
  private var totalInputSamples = 0
  private var totalConvertedSamples = 0
  private var conversionFailures = 0
  private var floatExtractionFailures = 0
  private var emittedChunks = 0
  private var flushedTailSamples = 0
  private var lastChunkRms = 0.0
  private var lastConversionError: String?
  private var runtimeErrorEmitted = false
  private let targetSampleRate: Double
  private let sharedPlaybackReference: Bool
  private(set) var pcmPlayback: VoiceProcessingPcmPlayer?

  init(audioSessionCoordinator: AudioSessionCoordinator, owner: String = "coreml_nemotron_asr",
       sampleRate: Double = 16_000, sharedPlaybackReference: Bool = false) {
    self.audioSessionCoordinator = audioSessionCoordinator
    self.audioSessionOwner = owner
    self.targetSampleRate = sampleRate
    self.sharedPlaybackReference = sharedPlaybackReference
  }

  func start(
    chunkDurationMs: Int,
    onRuntimeError: @escaping (String, String) -> Void,
    onChunk: @escaping ([Float]) -> Void
  ) throws {
    _ = stop()
    try configureAudioSession()
    if sharedPlaybackReference {
      engineInvalidations = 0
      audioSessionCoordinator.bindPublicCaptureEngine(engine) { [weak self] in
        self?.engineInvalidations += 1
      }
    }
    do {
      try configureVoiceProcessing()
      if sharedPlaybackReference { pcmPlayback = try VoiceProcessingPcmPlayer(engine: engine) }
    } catch {
      if sharedPlaybackReference { audioSessionCoordinator.unbindPublicCaptureEngine(engine) }
      deactivateAudioSession()
      throw error
    }

    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    lastInputSampleRate = Int(inputFormat.sampleRate)
    lastInputChannels = Int(inputFormat.channelCount)
    let targetFormat = AVAudioFormat(
      commonFormat: .pcmFormatFloat32,
      sampleRate: targetSampleRate,
      channels: 1,
      interleaved: false
    )!
    let converter = AVAudioConverter(from: inputFormat, to: targetFormat)
    let chunkSamples = max(1, Int(targetSampleRate * Double(chunkDurationMs) / 1000.0))
    lastChunkSamples = chunkSamples
    resetStats()

    input.installTap(
      onBus: 0,
      bufferSize: 1024,
      format: inputFormat
    ) { [weak self] buffer, _ in
      guard let self else { return }
      let result = Self.convertPcm(buffer: buffer, converter: converter, format: targetFormat)
      let converted = result.buffer
      let samples = Self.floatSamples(from: converted)
      let inputSampleCount = Int(buffer.frameLength)
      self.queue.async {
        self.totalInputBuffers += 1
        self.totalInputSamples += inputSampleCount
        if let error = result.error {
          self.conversionFailures += 1
          self.lastConversionError = error
          self.emitRuntimeError(
            code: "audio_conversion_failed",
            message: error,
            handler: onRuntimeError
          )
        }
        if samples.isEmpty && converted.frameLength > 0 {
          self.floatExtractionFailures += 1
          self.lastConversionError = "float_channel_data_missing"
          self.emitRuntimeError(
            code: "audio_float_extraction_failed",
            message: "Audio converter returned samples without Float32 channel data",
            handler: onRuntimeError
          )
        }
        self.totalConvertedSamples += samples.count
        self.pendingSamples.append(contentsOf: samples)
        while self.pendingSamples.count >= chunkSamples {
          let chunk = Array(self.pendingSamples.prefix(chunkSamples))
          self.pendingSamples.removeFirst(chunkSamples)
          self.emittedChunks += 1
          self.lastChunkRms = Self.rootMeanSquare(chunk)
          onChunk(chunk)
        }
      }
    }
    tapInstalled = true

    engine.prepare()
    do {
      try engine.start()
      running = true
    } catch {
      stop()
      throw error
    }
  }

  func stop(flushPending: Bool = false) -> [Float] {
    // Retire ownership before any graph teardown can post notifications.
    if sharedPlaybackReference { audioSessionCoordinator.unbindPublicCaptureEngine(engine) }
    pcmPlayback?.stop()
    if sharedPlaybackReference { engine.stop() }
    deactivateVoiceProcessing()
    if tapInstalled {
      engine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    if engine.isRunning {
      engine.stop()
    }
    let tail = queue.sync {
      let tail = flushPending ? pendingSamples : []
      if !tail.isEmpty {
        emittedChunks += 1
        flushedTailSamples += tail.count
        lastChunkRms = Self.rootMeanSquare(tail)
      }
      pendingSamples.removeAll()
      return tail
    }
    running = false
    deactivateAudioSession()
    return tail
  }

  func pause() { pcmPlayback?.stop(); engine.pause(); running = false }
  func resume() throws { try engine.start(); running = true }
  var pcmReadiness: PcmCaptureReadiness {
    PcmCaptureReadiness(inputStarted:running,engineRunning:engine.isRunning,referenceBound:pcmPlayback != nil,
      inputProcessing:engine.inputNode.isVoiceProcessingEnabled,outputProcessing:engine.outputNode.isVoiceProcessingEnabled,
      bypassed:engine.inputNode.isVoiceProcessingBypassed)
  }
  var canPlayPcm: Bool { pcmReadiness.ready }

  func payload() -> [String: Any] {
    let stats = queue.sync {
      var stats: [String: Any] = [
        "pendingSamples": pendingSamples.count,
        "inputBuffers": totalInputBuffers,
        "inputSamples": totalInputSamples,
        "convertedSamples": totalConvertedSamples,
        "conversionFailures": conversionFailures,
        "floatExtractionFailures": floatExtractionFailures,
        "emittedChunks": emittedChunks,
      "flushedTailSamples": flushedTailSamples,
      "lastChunkRms": lastChunkRms,
      "runtimeErrorEmitted": runtimeErrorEmitted
      ]
      if let lastConversionError {
        stats["lastConversionError"] = lastConversionError
      }
      return stats
    }
    var payload: [String: Any] = [
      "running": running,
      "sharedPlaybackReference": sharedPlaybackReference && pcmPlayback != nil,
      "inputVoiceProcessingEnabled": sharedPlaybackReference ? engine.inputNode.isVoiceProcessingEnabled : lastVoiceProcessingEnabled,
      "outputVoiceProcessingEnabled": sharedPlaybackReference && engine.outputNode.isVoiceProcessingEnabled,
      "tapInstalled": tapInstalled,
      "sessionActive": audioSessionActive,
      "voiceProcessingPolicy": "apple_voice_processing_aec_ns",
      "voiceProcessingAttempted": voiceProcessingAttempted,
      "lastVoiceProcessingEnabled": lastVoiceProcessingEnabled,
      "lastVoiceProcessingAgcEnabled": lastVoiceProcessingAgcEnabled,
      "targetSampleRate": Int(targetSampleRate),
      "lastChunkSamples": lastChunkSamples,
      "inputSampleRate": lastInputSampleRate,
      "inputChannels": lastInputChannels
    ]
    payload.merge(stats) { _, value in value }
    if sharedPlaybackReference {
      payload["pcmReadiness"] = pcmReadiness.payload
      payload["bypassedBeforeConfiguration"] = bypassedBeforeConfiguration
      payload["engineInvalidations"] = engineInvalidations
    }
    if let audioSessionError {
      payload["sessionError"] = audioSessionError
    }
    if let voiceProcessingError {
      payload["voiceProcessingError"] = voiceProcessingError
    }
    return payload
  }

  private func resetStats() {
    queue.sync {
      pendingSamples.removeAll()
      totalInputBuffers = 0
      totalInputSamples = 0
      totalConvertedSamples = 0
      conversionFailures = 0
      floatExtractionFailures = 0
      emittedChunks = 0
      flushedTailSamples = 0
      lastChunkRms = 0
      lastConversionError = nil
      runtimeErrorEmitted = false
    }
  }

  private func emitRuntimeError(
    code: String,
    message: String,
    handler: (String, String) -> Void
  ) {
    guard !runtimeErrorEmitted else { return }
    runtimeErrorEmitted = true
    handler(code, message)
  }

  private func configureAudioSession() throws {
    do {
      try audioSessionCoordinator.beginCapture(owner: audioSessionOwner)
      audioSessionActive = true
      audioSessionError = nil
    } catch {
      audioSessionActive = false
      audioSessionError = error.localizedDescription
      throw error
    }
  }

  private func configureVoiceProcessing() throws {
    voiceProcessingAttempted = true
    lastVoiceProcessingEnabled = false
    lastVoiceProcessingAgcEnabled = false
    do {
      guard #available(iOS 13.0, *) else {
        throw NSError(
          domain: "CoreMlNemotronAudioInput",
          code: 1,
          userInfo: [
            NSLocalizedDescriptionKey: "Apple voice processing requires iOS 13 or later"
          ]
        )
      }
      let input = engine.inputNode
      try input.setVoiceProcessingEnabled(true)
      input.isVoiceProcessingAGCEnabled = false
      if sharedPlaybackReference {
        bypassedBeforeConfiguration = input.isVoiceProcessingBypassed
        input.isVoiceProcessingBypassed = false
      }
      guard input.isVoiceProcessingEnabled else {
        throw NSError(
          domain: "CoreMlNemotronAudioInput",
          code: 2,
          userInfo: [
            NSLocalizedDescriptionKey: "Apple voice processing did not become active"
          ]
        )
      }
      lastVoiceProcessingEnabled = true
      lastVoiceProcessingAgcEnabled = input.isVoiceProcessingAGCEnabled
      voiceProcessingError = nil
    } catch {
      voiceProcessingError = error.localizedDescription
      throw error
    }
  }

  private func deactivateVoiceProcessing() {
    guard voiceProcessingAttempted else { return }
    if #available(iOS 13.0, *) {
      try? engine.inputNode.setVoiceProcessingEnabled(false)
    }
  }

  private func deactivateAudioSession() {
    guard audioSessionActive else { return }
    audioSessionCoordinator.endCapture(owner: audioSessionOwner)
    audioSessionActive = false
    audioSessionError = nil
  }

  static func convertPcm(
    buffer: AVAudioPCMBuffer,
    converter: AVAudioConverter?,
    format: AVAudioFormat
  ) -> (buffer: AVAudioPCMBuffer, error: String?) {
    guard let converter else { return (buffer, "converter_unavailable") }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 8
    guard let converted = AVAudioPCMBuffer(
      pcmFormat: format,
      frameCapacity: capacity
    ) else { return (buffer, "converted_buffer_allocation_failed") }

    var didProvideInput = false
    var error: NSError?
    converter.convert(to: converted, error: &error) { _, status in
      if didProvideInput {
        status.pointee = .noDataNow
        return nil
      }
      didProvideInput = true
      status.pointee = .haveData
      return buffer
    }
    if let error {
      return (buffer, error.localizedDescription)
    }
    return (converted, nil)
  }

  static func floatSamples(from buffer: AVAudioPCMBuffer) -> [Float] {
    guard let channel = buffer.floatChannelData?[0] else { return [] }
    let count = Int(buffer.frameLength)
    return Array(UnsafeBufferPointer(start: channel, count: count))
  }

  private static func rootMeanSquare(_ samples: [Float]) -> Double {
    guard !samples.isEmpty else { return 0 }
    var sumSquares = 0.0
    for sample in samples {
      let value = Double(sample)
      sumSquares += value * value
    }
    return sqrt(sumSquares / Double(samples.count))
  }
}
