import Foundation

struct CoreMlNemotronEndpointState {
  let rms: Double
  let hasSpeech: Bool
  let shouldFinalize: Bool
}

final class CoreMlNemotronEndpointDetector {
  private let sampleRate: Double
  private let speechThresholdRms: Double
  private let minSpeechMs: Int
  private let endpointSilenceMs: Int
  private let minSpeechSamples: Int
  private let endpointSilenceSamples: Int

  private var speechSamples = 0
  private var silenceSamples = 0
  private var hasOpenSpeech = false
  private var lastRms = 0.0
  private var finalizedSegments = 0

  init(
    sampleRate: Double = 16_000,
    speechThresholdRms: Double = 0.006,
    minSpeechMs: Int = 600,
    endpointSilenceMs: Int = 900
  ) {
    self.sampleRate = sampleRate
    self.speechThresholdRms = speechThresholdRms
    self.minSpeechMs = minSpeechMs
    self.endpointSilenceMs = endpointSilenceMs
    self.minSpeechSamples = Int(sampleRate * Double(minSpeechMs) / 1000.0)
    self.endpointSilenceSamples = Int(sampleRate * Double(endpointSilenceMs) / 1000.0)
  }

  func accept(samples: [Float]) -> CoreMlNemotronEndpointState {
    let rms = rootMeanSquare(samples)
    lastRms = rms
    let hasSpeech = rms >= speechThresholdRms

    if hasSpeech {
      hasOpenSpeech = true
      speechSamples += samples.count
      silenceSamples = 0
      return CoreMlNemotronEndpointState(
        rms: rms,
        hasSpeech: true,
        shouldFinalize: false
      )
    }

    if hasOpenSpeech {
      silenceSamples += samples.count
    }
    let shouldFinalize = hasOpenSpeech
      && speechSamples >= minSpeechSamples
      && silenceSamples >= endpointSilenceSamples
    if shouldFinalize {
      finalizedSegments += 1
      reset()
    }

    return CoreMlNemotronEndpointState(
      rms: rms,
      hasSpeech: false,
      shouldFinalize: shouldFinalize
    )
  }

  func reset() {
    speechSamples = 0
    silenceSamples = 0
    hasOpenSpeech = false
  }

  func payload() -> [String: Any] {
    [
      "sampleRate": Int(sampleRate),
      "speechThresholdRms": speechThresholdRms,
      "minSpeechMs": minSpeechMs,
      "endpointSilenceMs": endpointSilenceMs,
      "minSpeechSamples": minSpeechSamples,
      "endpointSilenceSamples": endpointSilenceSamples,
      "speechSamples": speechSamples,
      "silenceSamples": silenceSamples,
      "hasOpenSpeech": hasOpenSpeech,
      "lastRms": lastRms,
      "finalizedSegments": finalizedSegments
    ]
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
