import Foundation

@main
struct AppleSpeechHypothesisTest {
  static func main() throws {
    var tracker = AppleSpeechHypothesisTracker()
    let partial = try tracker.accept(text: "Wi-F", start: 0, end: 190000,
      final: false, finalizedThrough: 0).last!
    let final = try tracker.accept(text: "Wi-Fi", start: 35520, end: 190000,
      final: true, finalizedThrough: 190000).last!
    precondition(partial.key == final.key && final.final)
    let repeated = try tracker.accept(text: "Wi-Fi", start: 194880, end: 200000,
      final: true, finalizedThrough: 200000).last!
    precondition(repeated.key != final.key)
    _ = try tracker.accept(text: "unchanged", start: 201000, end: 210000,
      final: false, finalizedThrough: 200000)
    let watermarked = try tracker.accept(text: "next", start: 220000, end: 230000,
      final: false, finalizedThrough: 210000)
    precondition(watermarked.count == 2 && watermarked.first!.text == "unchanged"
      && watermarked.first!.final && !watermarked.last!.final)
    let revoked = try tracker.accept(text: "", start: 220000, end: 230000,
      final: false, finalizedThrough: 210000)
    precondition(revoked.count == 1 && revoked[0].retracted && revoked[0].text.isEmpty)
    precondition(tracker.finalize(through: 240000).isEmpty)
    let a = try tracker.accept(text: "a", start: 250000, end: 260000,
      final: false, finalizedThrough: 240000).last!
    let b = try tracker.accept(text: "b", start: 260000, end: 270000,
      final: false, finalizedThrough: 240000).last!
    let merged = try tracker.accept(text: "ab", start: 250000, end: 270000,
      final: false, finalizedThrough: 240000)
    precondition(merged.count == 2 && merged.contains { $0.key == b.key && $0.retracted })
    let eof = tracker.finalize(through: 270000)
    precondition(eof.count == 1 && eof[0].key == a.key && eof[0].text == "ab" && eof[0].final)
    precondition(tracker.finalize(through: 270000).isEmpty)
    let payload = eof[0].payload(sessionId: "s", captureId: "c", policy: "p", language: "fr", revision: 10)
    precondition(payload["id"] as? String == "s:\(a.key)" && payload["language"] as? String == "fr")
    for i in 0..<128 {
      _ = try tracker.accept(text: "\(i)", start: 300000 + i * 10, end: 300001 + i * 10,
        final: false, finalizedThrough: 270000)
    }
    do {
      _ = try tracker.accept(text: "overflow", start: 400000, end: 400001,
        final: false, finalizedThrough: 270000)
      fatalError("unbounded volatile queue")
    } catch AppleSpeechFailure.queueOverflow {}
    print("PASS stable identity, genuine repeats, watermark, revocation, coalescing, EOF, payload and bounds")
  }
}
