import AVFoundation
import Foundation

@main struct IosPublicEchoContinuityTest {
  static func main() {
    let frame = [Float](repeating: 0.02, count: 4096)
    let observed: [(Int, Double, Double, Int, Bool)] = [
      (147456, 0.377, 0.468, -252, true),
      (151552, 0.338, 0.215, 307, false),
      (155648, 0.748, 0.429, -267, false),
      (159744, 0.174, 0.349, -239, false),
      (163840, 0.042, 0.127, -318, false),
      (167936, 0.025, 0, 0, false)
    ]
    var gate = PcmRenderEchoGate()
    let detector = CoreMlNemotronEndpointDetector(vadThreshold: 0.6,
      vadNegativeThreshold: 0.35, minSpeechMs: 96, endpointSilenceMs: 640)
    var activity = AppleSpeechActivityGate(preRollSamples: 12800)
    var echoRanges: [Range<Int>] = []
    for (start, probability, correlation, lag, direct) in observed {
      let echo = gate.evaluate(.init(matched: direct, correlation: correlation, lagMs: lag),
        analysisStart: start, frameSamples: frame.count)
      let result = detector.acceptVadFrame(probability: probability, samples: frame,
        provider: "physical_3002_metadata_replay", speechStartAllowed: !echo.matched)
      activity.advance(through: start + frame.count,
        speechEvent: result.speechStarted ? (true, start + frame.count) :
          result.shouldFinalize ? (false, max(0, start + frame.count - result.trailingSilenceSamples)) : nil)
      if echo.matched { echoRanges.append(start..<(start + frame.count)) }
      precondition(!result.speechStarted)
      if start == 155648 { precondition(echo.carried && echo.matched) }
    }
    activity.finish()
    let evidence = appleOnlineAudioEvidence(sessionMatches: true, inputSampleRate: 16000,
      range: ["startSample": 9050 * 16, "endSample": 10170 * 16, "sampleRate": 16000],
      analysedThrough: 172032, retainedFrom: 0, activity: activity,
      renderEchoRanges: echoRanges)
    precondition(evidence["decision"] as? String == "non_speech")

    // A later independent utterance cannot be held by a carried echo frame.
    var bargeGate = PcmRenderEchoGate()
    _ = bargeGate.evaluate(.init(matched: true, correlation: 0.468, lagMs: -252),
      analysisStart: 147456, frameSamples: frame.count)
    _ = bargeGate.evaluate(.init(matched: false, correlation: 0.215, lagMs: 307),
      analysisStart: 151552, frameSamples: frame.count)
    _ = bargeGate.evaluate(.init(matched: false, correlation: 0.429, lagMs: -267),
      analysisStart: 155648, frameSamples: frame.count)
    let nearVoice = bargeGate.evaluate(.init(matched: false, correlation: 0.10, lagMs: 90),
      analysisStart: 159744, frameSamples: frame.count)
    precondition(!nearVoice.matched)
    let freshDetector = CoreMlNemotronEndpointDetector(vadThreshold: 0.6,
      vadNegativeThreshold: 0.35, minSpeechMs: 96, endpointSilenceMs: 640)
    precondition(freshDetector.acceptVadFrame(probability: 0.81, samples: frame,
      provider: "independent_near_voice", speechStartAllowed: !nearVoice.matched).speechStarted)
    print("PASS: observed residual echo has no speech evidence; later independent voice remains eligible")
  }
}
