import Foundation

@main
struct AppleSpeechInputQueueTest {
  static func main() async throws {
    let defaults = try AppleSpeechConfiguration()
    precondition(defaults.chunkDurationMs == 32 && defaults.minSpeechMs == 96 && defaults.silenceMs == 640)
    let custom = try AppleSpeechConfiguration(arguments: [
      "chunkDurationMs": 48, "endpointMinSpeechMs": 600, "endpointSilenceMs": 512,
      "vadThreshold": 0.8, "vadNegativeThreshold": 0.3, "vadPreRollMs": 256])
    precondition(custom.chunkDurationMs == 48 && custom.preRollSamples == 4096)
    precondition(custom.fingerprint != defaults.fingerprint && custom.fingerprint.count == 64)
    let roundTrip = try AppleSpeechConfiguration(arguments: custom.parameters)
    precondition(roundTrip.fingerprint == custom.fingerprint)
    let invalidConfigurations: [[String: Any]] = [
      ["chunkDurationMs": 0], ["chunkDurationMs": 3.5], ["vadThreshold": Double.nan],
      ["vadThreshold": true], ["vadPreRollMs": false], ["vadNegativeThreshold": 0.9],
      ["endpointMinSpeechMs": -1], ["vadProvider": "rms"], ["vadThreshold": "0.6"]
    ]
    for invalid in invalidConfigurations {
      do { _ = try AppleSpeechConfiguration(arguments: invalid); fatalError("invalid parameters accepted") }
      catch AppleSpeechFailure.invalidConfiguration {}
    }
    let detector = CoreMlNemotronEndpointDetector(vadThreshold: custom.threshold,
      vadNegativeThreshold: custom.negativeThreshold, minSpeechMs: custom.minSpeechMs,
      endpointSilenceMs: custom.silenceMs)
    let frame = Array(repeating: Float(0.1), count: 4096)
    precondition(!detector.acceptVadFrame(probability: 0.7, samples: frame, provider: "test").speechStarted)
    precondition(!detector.acceptVadFrame(probability: 0.9, samples: frame, provider: "test").speechStarted)
    precondition(!detector.acceptVadFrame(probability: 0.9, samples: frame, provider: "test").speechStarted)
    let opened = detector.acceptVadFrame(probability: 0.9, samples: frame, provider: "test")
    precondition(opened.speechStarted && opened.confirmedSpeechSamples == 12288)
    precondition(!detector.acceptVadFrame(probability: 0.2, samples: frame, provider: "test").shouldFinalize)
    let closed = detector.acceptVadFrame(probability: 0.2, samples: frame, provider: "test")
    precondition(closed.shouldFinalize && closed.trailingSilenceSamples == 8192)

    var silence = AppleSpeechActivityGate(preRollSamples: 12800)
    precondition(silence.decision(start: 0, end: 1600) == .wait)
    silence.advance(through: 32000, speechEvent: nil)
    precondition(silence.decision(start: 0, end: 1600) == .reject)
    silence.finish()
    precondition(silence.decision(start: 24000, end: 32000) == .reject)

    var speech = AppleSpeechActivityGate(preRollSamples: 1600)
    speech.advance(through: 4096, speechEvent: nil)
    precondition(speech.decision(start: 3500, end: 4096) == .wait)
    speech.advance(through: 8192, speechEvent: (true, 4600))
    precondition(speech.decision(start: 3500, end: 6000) == .accept)
    precondition(speech.decision(start: 0, end: 1000) == .reject)
    speech.advance(through: 12000, speechEvent: (false, 9000))
    speech.finish()
    precondition(speech.decision(start: 7000, end: 9000) == .accept)
    precondition(speech.decision(start: 9500, end: 11000) == .reject)
    var tail = AppleSpeechActivityGate()
    tail.advance(through: 4096, speechEvent: (true, 1000)); tail.finish()
    precondition(tail.decision(start: 1000, end: 4000) == .accept)

    let queue = AppleSpeechInputQueue(capacity: 4)
    queue.append([1, 2]); queue.append([3]); queue.finish(tail: [4])
    queue.append([5])
    var packets: [AppleSpeechPacket] = []
    for try await packet in queue.stream { packets.append(packet) }
    precondition(packets.map(\.offset) == [0, 2, 3])
    precondition(packets.flatMap(\.samples) == [1, 2, 3, 4])
    precondition(queue.snapshot().accepted == 4)

    let empty = AppleSpeechInputQueue(); empty.finish()
    for try await _ in empty.stream { fatalError("empty EOI must not create a PCM packet") }
    let full = AppleSpeechInputQueue(capacity: 1)
    full.append([1]); full.append([2]); full.finish()
    do { for try await _ in full.stream {}; fatalError("overflow was hidden") }
    catch AppleSpeechFailure.queueOverflow {}
    precondition(full.snapshot().overflow && full.snapshot().received == 2)

    // Cancellation-insensitive operation must not keep the deadline waiting.
    let start = Date()
    do {
      try await appleSpeechWithDeadline(nanoseconds: 30_000_000) {
        await withCheckedContinuation { c in
          DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) { c.resume() }
        }
      }
      fatalError("deadline did not fire")
    } catch AppleSpeechFailure.stopTimeout {}
    precondition(Date().timeIntervalSince(start) < 0.25)
    try await Task.sleep(nanoseconds: 350_000_000) // late completion must not resume twice
    try await appleSpeechWithDeadline { }
    print("PASS configuration validation/fingerprint, original endpoint min-speech/hysteresis, VAD-gated silence/short/pre-roll/EOF/tail, ordered PCM, overflow, deadline and late completion")
  }
}
