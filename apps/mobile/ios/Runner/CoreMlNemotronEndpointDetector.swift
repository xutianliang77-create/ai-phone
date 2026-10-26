import Foundation

struct CoreMlNemotronEndpointState {
  let rms: Double
  let vadProbability: Double?
  let hasSpeech: Bool
  let speechStarted: Bool
  let shouldFinalize: Bool
  let endpointReason: String?
  let confirmedSpeechSamples: Int
  let trailingSilenceSamples: Int
}

final class CoreMlNemotronEndpointDetector {
  private let sampleRate: Double
  private let speechThresholdRms: Double
  private let vadThreshold: Double
  private let vadNegativeThreshold: Double
  private let minSpeechMs: Int
  private let endpointSilenceMs: Int
  private let minSpeechSamples: Int
  private let endpointSilenceSamples: Int

  private var candidateSpeechSamples = 0
  private var speechSamples = 0
  private var silenceSamples = 0
  private var hasOpenSpeech = false
  private var lastRms = 0.0
  private var lastVadProbability: Double?
  private var lastProvider = "not_started"
  private var lastEndpointReason: String?
  private var speechStarts = 0
  private var finalizedSegments = 0

  init(
    sampleRate: Double = 16_000,
    speechThresholdRms: Double = 0.006,
    vadThreshold: Double = 0.6,
    vadNegativeThreshold: Double = 0.35,
    minSpeechMs: Int = 600,
    endpointSilenceMs: Int = 900
  ) {
    self.sampleRate = sampleRate
    self.speechThresholdRms = speechThresholdRms
    self.vadThreshold = vadThreshold
    self.vadNegativeThreshold = min(vadNegativeThreshold, vadThreshold)
    self.minSpeechMs = minSpeechMs
    self.endpointSilenceMs = endpointSilenceMs
    self.minSpeechSamples = Int(sampleRate * Double(minSpeechMs) / 1000.0)
    self.endpointSilenceSamples =
      Int(sampleRate * Double(endpointSilenceMs) / 1000.0)
  }

  var isSpeechOpen: Bool {
    hasOpenSpeech
  }

  func acceptVadFrame(
    probability: Double,
    samples: [Float],
    provider: String,
    speechStartAllowed: Bool = true
  ) -> CoreMlNemotronEndpointState {
    accept(
      rms: rootMeanSquare(samples),
      probability: probability,
      sampleCount: samples.count,
      isSpeechOn: speechStartAllowed && probability >= vadThreshold,
      isSpeechOff:
        !speechStartAllowed || probability < vadNegativeThreshold,
      provider: provider,
      endpointReason: "vad_silence"
    )
  }

  func acceptRms(
    samples: [Float],
    provider: String,
    speechStartAllowed: Bool = true
  ) -> CoreMlNemotronEndpointState {
    let rms = rootMeanSquare(samples)
    return accept(
      rms: rms,
      probability: nil,
      sampleCount: samples.count,
      isSpeechOn: speechStartAllowed && rms >= speechThresholdRms,
      isSpeechOff:
        !speechStartAllowed || rms < speechThresholdRms * 0.7,
      provider: provider,
      endpointReason: "rms_fallback_silence"
    )
  }

  func reset() {
    candidateSpeechSamples = 0
    speechSamples = 0
    silenceSamples = 0
    hasOpenSpeech = false
  }

  func payload() -> [String: Any] {
    [
      "sampleRate": Int(sampleRate),
      "speechThresholdRms": speechThresholdRms,
      "vadThreshold": vadThreshold,
      "vadNegativeThreshold": vadNegativeThreshold,
      "minSpeechMs": minSpeechMs,
      "endpointSilenceMs": endpointSilenceMs,
      "minSpeechSamples": minSpeechSamples,
      "endpointSilenceSamples": endpointSilenceSamples,
      "candidateSpeechSamples": candidateSpeechSamples,
      "speechSamples": speechSamples,
      "silenceSamples": silenceSamples,
      "hasOpenSpeech": hasOpenSpeech,
      "lastRms": lastRms,
      "lastVadProbability": lastVadProbability as Any,
      "lastProvider": lastProvider,
      "lastEndpointReason": lastEndpointReason as Any,
      "speechStarts": speechStarts,
      "finalizedSegments": finalizedSegments
    ]
  }

  private func accept(
    rms: Double,
    probability: Double?,
    sampleCount: Int,
    isSpeechOn: Bool,
    isSpeechOff: Bool,
    provider: String,
    endpointReason: String
  ) -> CoreMlNemotronEndpointState {
    lastRms = rms
    lastVadProbability = probability
    lastProvider = provider
    var speechStarted = false

    if hasOpenSpeech {
      if isSpeechOff {
        silenceSamples += sampleCount
      } else {
        speechSamples += sampleCount
        silenceSamples = 0
      }
    } else if isSpeechOn {
      candidateSpeechSamples += sampleCount
      if candidateSpeechSamples >= minSpeechSamples {
        hasOpenSpeech = true
        speechSamples = candidateSpeechSamples
        silenceSamples = 0
        speechStarted = true
        speechStarts += 1
      }
    } else if isSpeechOff {
      candidateSpeechSamples = 0
    }

    let shouldFinalize =
      hasOpenSpeech && silenceSamples >= endpointSilenceSamples
    let confirmedSpeechSamples = speechSamples
    let trailingSilenceSamples = silenceSamples
    if shouldFinalize {
      finalizedSegments += 1
      lastEndpointReason = endpointReason
      reset()
    }

    return CoreMlNemotronEndpointState(
      rms: rms,
      vadProbability: probability,
      hasSpeech: isSpeechOn || (hasOpenSpeech && !isSpeechOff),
      speechStarted: speechStarted,
      shouldFinalize: shouldFinalize,
      endpointReason: shouldFinalize ? endpointReason : nil,
      confirmedSpeechSamples: confirmedSpeechSamples,
      trailingSilenceSamples: trailingSilenceSamples
    )
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
