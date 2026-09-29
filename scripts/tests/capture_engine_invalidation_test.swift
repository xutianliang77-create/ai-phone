import Foundation

private final class TestEngine {}

@main struct CaptureEngineInvalidationTest {
  static func main() {
    let gate = CaptureEngineInvalidationGate<TestEngine>()
    let idleOther = TestEngine(), first = TestEngine(), replacement = TestEngine()
    precondition(gate.token(for: idleOther) == nil)
    gate.begin(managed: true)
    // Public ownership begins before native input construction; an existing
    // inactive ASR/recorder engine cannot invalidate the capture-to-be.
    precondition(gate.token(for: idleOther) == nil)
    precondition(gate.token(for: first) == nil)
    gate.bind(first)
    precondition(gate.token(for: idleOther) == nil)
    let initial = gate.token(for: first)!
    precondition(!gate.shouldInvalidate(first, token: initial, isRunning: true, interrupted: false))
    precondition(!gate.shouldInvalidate(first, token: initial, isRunning: false, interrupted: true))
    // A genuine current-graph stop still requests recovery exactly once.
    precondition(gate.shouldInvalidate(first, token: initial, isRunning: false, interrupted: false))
    precondition(!gate.shouldInvalidate(first, token: initial, isRunning: false, interrupted: false))
    precondition(gate.unbind(first))
    precondition(gate.token(for: first) == nil)
    precondition(gate.token(for: idleOther) == nil)
    gate.bind(replacement)
    precondition(!gate.unbind(first)) // old cleanup cannot retire the new graph
    precondition(!gate.shouldInvalidate(first, token: initial, isRunning: false, interrupted: false))
    let next = gate.token(for: replacement)!
    // Repeated begin during recovery must not lose the selected engine.
    gate.begin(managed: true)
    precondition(gate.token(for: replacement) == next)
    precondition(gate.shouldInvalidate(replacement, token: next, isRunning: false, interrupted: false))
    gate.end()
    precondition(!gate.shouldInvalidate(replacement, token: next, isRunning: false, interrupted: false))
    gate.begin(managed: false)
    precondition(gate.token(for: first) == nil)
    precondition(gate.token(for: replacement) == nil)
    let legacy = gate.token(for: idleOther)!
    precondition(!gate.shouldInvalidate(idleOther, token: legacy, isRunning: true, interrupted: false))
    precondition(gate.shouldInvalidate(idleOther, token: legacy, isRunning: false, interrupted: false))
    gate.end(); gate.begin(managed: false)
    precondition(!gate.shouldInvalidate(idleOther, token: legacy, isRunning: false, interrupted: false))
    // Device failure signature: 70 different retired/not-current engines.
    gate.begin(managed: true); gate.bind(replacement)
    for _ in 0..<70 {
      let old = TestEngine()
      precondition(gate.token(for: old) == nil)
    }
    precondition(gate.token(for: replacement) != nil)
    print("PASS: public current-engine ownership, 70 unrelated notifications, real route invalidation, deduplication, retired generation and legacy mode; no audio I/O")
  }
}
