import Foundation

/// Frozen 1.0 activity policy: onset/offset .5, ceil(100/80)=2 on frames,
/// ceil(320/80)=4 off frames. A bounded 4-frame hold makes the output immutable;
/// it affects speaker labels only, never the microphone, ASR or translation.
struct DeviceSpeakerActivityDecoder {
  struct Result { let startFrame: Int; let probabilities: [Float] }
  private struct Active {
    var start: Int, count = 0, sum: Float = 0
    var confirmed = false
    var off: Int?
  }
  private struct Pending { let frame: Int; var values = [Float](repeating:0,count:4) }
  private var active: [Int:Active] = [:]
  private var pending: [Pending] = []
  private var nextFrame = 0, emitted = 0

  mutating func consume(_ probabilities: [Float], startFrame: Int) throws -> Result {
    guard startFrame == nextFrame, probabilities.count % 4 == 0,
      probabilities.allSatisfy({$0.isFinite && $0 >= 0 && $0 <= 1}) else { throw Failure.invalidFrames }
    var output: [Float] = []
    let first = emitted
    for offset in stride(from:0,to:probabilities.count,by:4) {
      let frame = nextFrame; nextFrame += 1
      pending.append(Pending(frame:frame))
      for speaker in 0..<4 {
        let p = probabilities[offset+speaker]
        var state = active[speaker]
        if state == nil, p >= 0.5 { state = Active(start:frame) }
        else if var current = state {
          if !current.confirmed, p < 0.5 { state = nil }
          else if let off = current.off {
            if frame-off >= 4 { state = p >= 0.5 ? Active(start:frame) : nil }
            else if p >= 0.5 {
              current.off = nil; state = current
              mark(speaker,from:off,confidence:current.sum/Float(max(1,current.count)))
            }
          } else if p < 0.5 { current.off = frame; state = current }
        }
        if var current = state, current.off == nil {
          current.count += 1; current.sum += p
          let wasConfirmed = current.confirmed
          current.confirmed = current.confirmed || current.count >= 2
          if current.confirmed {
            mark(speaker,from:wasConfirmed ? frame : current.start,confidence:current.sum/Float(current.count))
          }
          state = current
        }
        active[speaker] = state
      }
      if pending.count > 4 { output.append(contentsOf:pending.removeFirst().values); emitted += 1 }
    }
    return Result(startFrame:first,probabilities:output)
  }
  mutating func flush() -> Result {
    let result = Result(startFrame:emitted,probabilities:pending.flatMap(\.values))
    emitted += pending.count; pending.removeAll(); active.removeAll()
    return result
  }
  private mutating func mark(_ speaker: Int, from start: Int, confidence: Float) {
    for i in pending.indices where pending[i].frame >= start { pending[i].values[speaker] = confidence }
  }
  enum Failure: Error { case invalidFrames }
}
