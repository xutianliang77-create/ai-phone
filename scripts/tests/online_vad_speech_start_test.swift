import Foundation
@main struct OnlineVadSpeechStartTest {
  static func main() {
    let detector = CoreMlNemotronEndpointDetector(minSpeechMs: 600, endpointSilenceMs: 900)
    let frame = [Float](repeating: 0.1, count: 4096)
    func accept(_ p: Double) -> CoreMlNemotronEndpointState {
      detector.acceptVadFrame(probability: p, samples: frame, provider: "synthetic_probability")
    }
    for _ in 0..<8 { let r = accept(0.01); precondition(!r.speechStarted && !r.shouldFinalize) }
    precondition(!accept(0.9).speechStarted)
    precondition(!accept(0.9).speechStarted)
    let start = accept(0.9)
    precondition(start.speechStarted && !start.shouldFinalize && detector.isSpeechOpen)
    for _ in 0..<10 { let r = accept(0.9); precondition(!r.speechStarted && !r.shouldFinalize) }
    for _ in 0..<3 { precondition(!accept(0.01).shouldFinalize) }
    let end = accept(0.01)
    precondition(!end.speechStarted && end.shouldFinalize && !detector.isSpeechOpen)
    print("PASS: confirmed speech-start precedes endpoint, no repeated start or quiet trigger; unchanged native VAD policy, synthetic probabilities")
  }
}
