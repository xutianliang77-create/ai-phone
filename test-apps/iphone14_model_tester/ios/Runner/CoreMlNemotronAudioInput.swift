import AVFoundation

final class CoreMlNemotronAudioInput {
  private let engine = AVAudioEngine()
  private let queue = DispatchQueue(label: "translation_mobile.coreml_nemotron.audio")
  private var pendingSamples: [Float] = []
  private var running = false
  private var tapInstalled = false
  private var audioSessionActive = false
  private var audioSessionError: String?
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
  private var maxChunkRms = 0.0
  private var totalChunkRms = 0.0
  private var rmsMeasurements = 0
  private var maxAbsSample = 0.0
  private var lastConversionError: String?
  private let targetSampleRate = 16_000.0

  func start(
    chunkDurationMs: Int,
    onChunk: @escaping ([Float]) -> Void
  ) throws {
    _ = stop()
    try configureAudioSession()

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
      let result = self.convert(buffer: buffer, converter: converter, format: targetFormat)
      let converted = result.buffer
      let samples = Self.floatSamples(from: converted)
      let inputSampleCount = Int(buffer.frameLength)
      self.queue.async {
        self.totalInputBuffers += 1
        self.totalInputSamples += inputSampleCount
        if let error = result.error {
          self.conversionFailures += 1
          self.lastConversionError = error
        }
        if samples.isEmpty && converted.frameLength > 0 {
          self.floatExtractionFailures += 1
          self.lastConversionError = "float_channel_data_missing"
        }
        self.totalConvertedSamples += samples.count
        self.pendingSamples.append(contentsOf: samples)
        while self.pendingSamples.count >= chunkSamples {
          let chunk = Array(self.pendingSamples.prefix(chunkSamples))
          self.pendingSamples.removeFirst(chunkSamples)
          self.emittedChunks += 1
          self.recordAudioStats(chunk)
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
        recordAudioStats(tail)
      }
      pendingSamples.removeAll()
      return tail
    }
    running = false
    deactivateAudioSession()
    return tail
  }

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
        "avgChunkRms": rmsMeasurements == 0 ? 0 : totalChunkRms / Double(rmsMeasurements),
        "maxChunkRms": maxChunkRms,
        "rmsMeasurements": rmsMeasurements,
        "maxAbsSample": maxAbsSample,
        "maxPcm16": Int(maxAbsSample * Double(Int16.max))
      ]
      if let lastConversionError {
        stats["lastConversionError"] = lastConversionError
      }
      return stats
    }
    var payload: [String: Any] = [
      "running": running,
      "tapInstalled": tapInstalled,
      "sessionActive": audioSessionActive,
      "targetSampleRate": Int(targetSampleRate),
      "lastChunkSamples": lastChunkSamples,
      "inputSampleRate": lastInputSampleRate,
      "inputChannels": lastInputChannels
    ]
    payload["audioRoute"] = Self.audioRoutePayload()
    payload.merge(stats) { _, value in value }
    if let audioSessionError {
      payload["sessionError"] = audioSessionError
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
      maxChunkRms = 0
      totalChunkRms = 0
      rmsMeasurements = 0
      maxAbsSample = 0
      lastConversionError = nil
    }
  }

  private func recordAudioStats(_ samples: [Float]) {
    let rms = Self.rootMeanSquare(samples)
    lastChunkRms = rms
    maxChunkRms = max(maxChunkRms, rms)
    totalChunkRms += rms
    rmsMeasurements += 1
    maxAbsSample = max(maxAbsSample, Self.maxAbsoluteSample(samples))
  }

  private func configureAudioSession() throws {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
      try session.setPreferredSampleRate(targetSampleRate)
      try session.setActive(true)
      audioSessionActive = true
      audioSessionError = nil
    } catch {
      audioSessionActive = false
      audioSessionError = error.localizedDescription
      throw error
    }
  }

  private func deactivateAudioSession() {
    guard audioSessionActive else { return }
    do {
      try AVAudioSession.sharedInstance().setActive(
        false,
        options: .notifyOthersOnDeactivation
      )
      audioSessionActive = false
      audioSessionError = nil
    } catch {
      audioSessionError = error.localizedDescription
    }
  }

  private func convert(
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

  private static func floatSamples(from buffer: AVAudioPCMBuffer) -> [Float] {
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

  private static func maxAbsoluteSample(_ samples: [Float]) -> Double {
    var peak = 0.0
    for sample in samples {
      peak = max(peak, Double(abs(sample)))
    }
    return peak
  }

  private static func audioRoutePayload() -> [String: Any] {
    let route = AVAudioSession.sharedInstance().currentRoute
    return [
      "inputs": route.inputs.map(routeDescriptionPayload),
      "outputs": route.outputs.map(routeDescriptionPayload)
    ]
  }

  private static func routeDescriptionPayload(_ item: AVAudioSessionPortDescription) -> [String: Any] {
    [
      "portType": item.portType.rawValue,
      "portName": item.portName,
      "uid": item.uid
    ]
  }
}
