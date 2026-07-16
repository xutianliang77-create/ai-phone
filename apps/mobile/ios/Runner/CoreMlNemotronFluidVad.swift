import CoreML
import Foundation

#if canImport(FluidAudio)
import FluidAudio
#endif

struct CoreMlNemotronPlaybackEchoSnapshot {
  let playbackActive: Bool
  let echoTailActive: Bool
  let echoSuppressionRequired: Bool
  let tailRemainingMs: Int

  var echoProtectionActive: Bool {
    echoSuppressionRequired && (playbackActive || echoTailActive)
  }
}

final class CoreMlNemotronPlaybackEchoState {
  static let tailMs = 350

  private let lock = NSLock()
  private var playbackActive = false
  private var echoSuppressionRequired = false
  private var tailUntilUptime = 0.0

  func reset() {
    lock.lock()
    playbackActive = false
    echoSuppressionRequired = false
    tailUntilUptime = 0
    lock.unlock()
  }

  @discardableResult
  func record(type: String, payload: [String: Any]) -> CoreMlNemotronPlaybackEchoSnapshot {
    let now = ProcessInfo.processInfo.systemUptime
    lock.lock()
    let required =
      payload["requiresAcousticEchoSuppression"] as? Bool
      ?? (type == "tts.begin" ? true : echoSuppressionRequired)
    switch type {
    case "tts.begin":
      echoSuppressionRequired = required
      playbackActive = required
      tailUntilUptime = 0
    case "tts.end", "tts.stop_requested":
      echoSuppressionRequired = required
      playbackActive = false
      tailUntilUptime = required
        ? now + Double(Self.tailMs) / 1000.0
        : 0
    default:
      break
    }
    let value = snapshotLocked(now: now)
    lock.unlock()
    return value
  }

  func snapshot() -> CoreMlNemotronPlaybackEchoSnapshot {
    let now = ProcessInfo.processInfo.systemUptime
    lock.lock()
    let value = snapshotLocked(now: now)
    lock.unlock()
    return value
  }

  func payload() -> [String: Any] {
    let value = snapshot()
    return [
      "playbackActive": value.playbackActive,
      "echoTailActive": value.echoTailActive,
      "echoSuppressionRequired": value.echoSuppressionRequired,
      "echoProtectionActive": value.echoProtectionActive,
      "tailMs": Self.tailMs,
      "tailRemainingMs": value.tailRemainingMs
    ]
  }

  private func snapshotLocked(
    now: TimeInterval
  ) -> CoreMlNemotronPlaybackEchoSnapshot {
    let tailActive =
      echoSuppressionRequired && !playbackActive && now < tailUntilUptime
    return CoreMlNemotronPlaybackEchoSnapshot(
      playbackActive: playbackActive,
      echoTailActive: tailActive,
      echoSuppressionRequired: echoSuppressionRequired,
      tailRemainingMs: tailActive
        ? max(0, Int((tailUntilUptime - now) * 1000.0))
        : 0
    )
  }
}

private struct CoreMlNemotronEchoGateDecision {
  let playback: CoreMlNemotronPlaybackEchoSnapshot
  let rms: Double
  let energyRatio: Double
  let speechStartAllowed: Bool
  let gateReason: String?
}

struct CoreMlNemotronVadDecision {
  let samplesToProcess: [Float]
  let speechStarted: Bool
  let shouldFinalize: Bool
  let endpointReason: String?
  let bargeIn: Bool
  let diagnosticEvents: [[String: Any]]
}

final class CoreMlNemotronFluidVad {
  private let configuredProvider: String
  private let preRollSamplesLimit: Int
  private let playbackEchoState: CoreMlNemotronPlaybackEchoState
  private let vadThreshold: Double
  private let echoBargeInRmsThreshold: Double
  private let detector: CoreMlNemotronEndpointDetector

  #if canImport(FluidAudio)
  private var manager: VadManager?
  private var streamState = VadStreamState.initial()
  #endif

  private var activeProvider = "not_prepared"
  private var fallbackReason: String?
  private var fallbackCount = 0
  private var pendingVadSamples: [Float] = []
  private var preRollSamples: [Float] = []
  private var processedVadFrames = 0
  private var processedVadSamples = 0
  private var processedInputSamples = 0
  private var lastProbability: Double?
  private var suppressedEchoStartChunks = 0
  private var allowedBargeIns = 0
  private var discardedEchoPreRollChunks = 0
  private var lastGateReason: String?

  init(
    options: CoreMlNemotronRuntimeOptions,
    playbackEchoState: CoreMlNemotronPlaybackEchoState
  ) {
    configuredProvider = options.vadProvider.trimmingCharacters(
      in: .whitespacesAndNewlines
    ).lowercased()
    self.playbackEchoState = playbackEchoState
    vadThreshold = options.vadThreshold
    echoBargeInRmsThreshold = options.endpointSpeechThresholdRms
    preRollSamplesLimit = max(
      0,
      Int(16_000 * Double(options.vadPreRollMs) / 1000.0)
    )
    detector = CoreMlNemotronEndpointDetector(
      speechThresholdRms: options.endpointSpeechThresholdRms,
      vadThreshold: options.vadThreshold,
      vadNegativeThreshold: options.vadNegativeThreshold,
      minSpeechMs: options.endpointMinSpeechMs,
      endpointSilenceMs: options.endpointSilenceMs
    )
  }

  func prepare() async {
    if configuredProvider == "rms" {
      activeProvider = "rms"
      return
    }
    #if canImport(FluidAudio)
    do {
      let config = VadConfig(
        defaultThreshold: Float(detector.payload()["vadThreshold"] as? Double ?? 0.6),
        computeUnits: .cpuAndNeuralEngine
      )
      if let modelURL = bundledModelURL() {
        let modelConfiguration = MLModelConfiguration()
        modelConfiguration.computeUnits = .cpuAndNeuralEngine
        let model = try MLModel(
          contentsOf: modelURL,
          configuration: modelConfiguration
        )
        manager = VadManager(config: config, vadModel: model)
      } else {
        manager = try await VadManager(config: config)
      }
      if let manager {
        streamState = await manager.makeStreamState()
      }
      activeProvider = "fluidaudio_silero"
      fallbackReason = nil
    } catch {
      activateRmsFallback(reason: error.localizedDescription)
    }
    #else
    activateRmsFallback(reason: "fluidaudio_unavailable")
    #endif
  }

  func accept(samples: [Float]) async -> CoreMlNemotronVadDecision {
    processedInputSamples += samples.count
    let wasSpeechOpen = detector.isSpeechOpen

    var speechStarted = false
    var shouldFinalize = false
    var endpointReason: String?
    var bargeIn = false
    var diagnosticEvents: [[String: Any]] = []
    var echoGate = makeEchoGateDecision(samples: samples)

    #if canImport(FluidAudio)
    if let manager, activeProvider == "fluidaudio_silero" {
      pendingVadSamples.append(contentsOf: samples)
      do {
        var chunkProbabilities: [Double] = []
        while pendingVadSamples.count >= VadManager.chunkSize {
          let frame = Array(pendingVadSamples.prefix(VadManager.chunkSize))
          pendingVadSamples.removeFirst(VadManager.chunkSize)
          let result = try await manager.processStreamingChunk(
            frame,
            state: streamState
          )
          streamState = result.state
          processedVadFrames += 1
          processedVadSamples += frame.count
          lastProbability = Double(result.probability)
          chunkProbabilities.append(Double(result.probability))
          diagnosticEvents.append([
            "kind": "frame",
            "sampleIndex": processedVadSamples,
            "timeMs": Int(
              Double(processedVadSamples) / 16_000.0 * 1000.0
            ),
            "provider": activeProvider,
            "probability": Double(result.probability),
            "frameSamples": frame.count
          ])
        }
        if let chunkProbability = chunkProbabilities.max() {
          echoGate = makeEchoGateDecision(samples: samples)
          let state = detector.acceptVadFrame(
            probability: chunkProbability,
            samples: samples,
            provider: activeProvider,
            speechStartAllowed: echoGate.speechStartAllowed
          )
          speechStarted = state.speechStarted
          shouldFinalize = state.shouldFinalize
          endpointReason = state.endpointReason
          trackEchoGate(
            gate: echoGate,
            probability: chunkProbability,
            speechStarted: speechStarted
          )
          bargeIn = speechStarted && echoGate.playback.echoProtectionActive
          diagnosticEvents.append(diagnosticEvent(
            state: state,
            sampleIndex: processedInputSamples,
            gate: echoGate
          ))
        }
      } catch {
        activateRmsFallback(reason: error.localizedDescription)
        echoGate = makeEchoGateDecision(samples: samples)
        let state = detector.acceptRms(
          samples: samples,
          provider: activeProvider,
          speechStartAllowed: echoGate.speechStartAllowed
        )
        speechStarted = state.speechStarted
        shouldFinalize = state.shouldFinalize
        endpointReason = state.endpointReason
        bargeIn = speechStarted && echoGate.playback.echoProtectionActive
        diagnosticEvents.append(diagnosticEvent(
          state: state,
          sampleIndex: processedInputSamples,
          gate: echoGate
        ))
      }
    } else {
      echoGate = makeEchoGateDecision(samples: samples)
      let state = detector.acceptRms(
        samples: samples,
        provider: activeProvider,
        speechStartAllowed: echoGate.speechStartAllowed
      )
      speechStarted = state.speechStarted
      shouldFinalize = state.shouldFinalize
      endpointReason = state.endpointReason
      bargeIn = speechStarted && echoGate.playback.echoProtectionActive
      diagnosticEvents.append(diagnosticEvent(
        state: state,
        sampleIndex: processedInputSamples,
        gate: echoGate
      ))
    }
    #else
    echoGate = makeEchoGateDecision(samples: samples)
    let state = detector.acceptRms(
      samples: samples,
      provider: activeProvider,
      speechStartAllowed: echoGate.speechStartAllowed
    )
    speechStarted = state.speechStarted
    shouldFinalize = state.shouldFinalize
    endpointReason = state.endpointReason
    bargeIn = speechStarted && echoGate.playback.echoProtectionActive
    diagnosticEvents.append(diagnosticEvent(
      state: state,
      sampleIndex: processedInputSamples,
      gate: echoGate
    ))
    #endif

    if !wasSpeechOpen {
      if echoGate.speechStartAllowed {
        appendPreRoll(samples)
      } else {
        preRollSamples.removeAll(keepingCapacity: true)
        discardedEchoPreRollChunks += 1
      }
    }
    let samplesToProcess: [Float]
    if speechStarted {
      samplesToProcess = preRollSamples
      preRollSamples.removeAll(keepingCapacity: true)
    } else if wasSpeechOpen {
      samplesToProcess = samples
    } else {
      samplesToProcess = []
    }

    if shouldFinalize {
      preRollSamples.removeAll(keepingCapacity: true)
    }
    return CoreMlNemotronVadDecision(
      samplesToProcess: samplesToProcess,
      speechStarted: speechStarted,
      shouldFinalize: shouldFinalize,
      endpointReason: endpointReason,
      bargeIn: bargeIn,
      diagnosticEvents: diagnosticEvents
    )
  }

  func resetSegment() async {
    detector.reset()
    pendingVadSamples.removeAll(keepingCapacity: true)
    preRollSamples.removeAll(keepingCapacity: true)
    #if canImport(FluidAudio)
    if let manager {
      streamState = await manager.makeStreamState()
    }
    #endif
  }

  func payload() -> [String: Any] {
    [
      "configuredProvider": configuredProvider,
      "activeProvider": activeProvider,
      "fallbackReason": fallbackReason as Any,
      "fallbackCount": fallbackCount,
      "preRollSamplesLimit": preRollSamplesLimit,
      "preRollBufferedSamples": preRollSamples.count,
      "pendingVadSamples": pendingVadSamples.count,
      "processedVadFrames": processedVadFrames,
      "processedVadSamples": processedVadSamples,
      "processedInputSamples": processedInputSamples,
      "lastProbability": lastProbability as Any,
      "echoBargeInRmsThreshold": echoBargeInRmsThreshold,
      "suppressedEchoStartChunks": suppressedEchoStartChunks,
      "allowedBargeIns": allowedBargeIns,
      "discardedEchoPreRollChunks": discardedEchoPreRollChunks,
      "lastGateReason": lastGateReason as Any,
      "playbackEcho": playbackEchoState.payload(),
      "endpoint": detector.payload()
    ]
  }

  private func appendPreRoll(_ samples: [Float]) {
    guard preRollSamplesLimit > 0 else { return }
    preRollSamples.append(contentsOf: samples)
    let overflow = preRollSamples.count - preRollSamplesLimit
    if overflow > 0 {
      preRollSamples.removeFirst(overflow)
    }
  }

  private func activateRmsFallback(reason: String) {
    #if canImport(FluidAudio)
    manager = nil
    streamState = VadStreamState.initial()
    #endif
    detector.reset()
    pendingVadSamples.removeAll(keepingCapacity: true)
    activeProvider = configuredProvider == "rms" ? "rms" : "rms_fallback"
    fallbackReason = reason
    fallbackCount += 1
  }

  private func bundledModelURL() -> URL? {
    Bundle.main.url(
      forResource: "silero-vad-unified-256ms-v6.0.0",
      withExtension: "mlmodelc",
      subdirectory: "Models/vad"
    )
  }

  private func diagnosticEvent(
    state: CoreMlNemotronEndpointState,
    sampleIndex: Int,
    gate: CoreMlNemotronEchoGateDecision
  ) -> [String: Any] {
    [
      "kind": "chunk_decision",
      "sampleIndex": sampleIndex,
      "timeMs": Int(Double(sampleIndex) / 16_000.0 * 1000.0),
      "provider": activeProvider,
      "probability": state.vadProbability as Any,
      "rms": state.rms,
      "hasSpeech": state.hasSpeech,
      "speechStarted": state.speechStarted,
      "shouldFinalize": state.shouldFinalize,
      "endpointReason": state.endpointReason as Any,
      "ttsActive": gate.playback.playbackActive,
      "echoTailActive": gate.playback.echoTailActive,
      "echoProtectionActive": gate.playback.echoProtectionActive,
      "energyRatio": gate.energyRatio,
      "speechStartAllowed": gate.speechStartAllowed,
      "gateReason": gate.gateReason as Any
    ]
  }

  private func makeEchoGateDecision(
    samples: [Float]
  ) -> CoreMlNemotronEchoGateDecision {
    let playback = playbackEchoState.snapshot()
    let rms = rootMeanSquare(samples)
    let energyRatio = echoBargeInRmsThreshold > 0
      ? rms / echoBargeInRmsThreshold
      : Double.greatestFiniteMagnitude
    let shouldProtectStart =
      playback.echoProtectionActive
      && !detector.isSpeechOpen
      && rms < echoBargeInRmsThreshold
    let reason: String?
    if shouldProtectStart {
      reason = playback.playbackActive
        ? "tts_active_low_energy"
        : "tts_tail_low_energy"
    } else {
      reason = nil
    }
    return CoreMlNemotronEchoGateDecision(
      playback: playback,
      rms: rms,
      energyRatio: energyRatio,
      speechStartAllowed: !shouldProtectStart,
      gateReason: reason
    )
  }

  private func trackEchoGate(
    gate: CoreMlNemotronEchoGateDecision,
    probability: Double,
    speechStarted: Bool
  ) {
    lastGateReason = gate.gateReason
    if !gate.speechStartAllowed && probability >= vadThreshold {
      suppressedEchoStartChunks += 1
    }
    if speechStarted && gate.playback.echoProtectionActive {
      allowedBargeIns += 1
    }
  }

  private func rootMeanSquare(_ samples: [Float]) -> Double {
    guard !samples.isEmpty else { return 0 }
    var sumSquares = 0.0
    for sample in samples {
      let value = Double(sample)
      sumSquares += value * value
    }
    return sqrt(sumSquares / Double(samples.count))
  }
}
