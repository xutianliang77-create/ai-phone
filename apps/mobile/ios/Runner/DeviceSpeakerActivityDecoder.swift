import Foundation

struct DeviceSpeakerActivityConfiguration: Equatable, Sendable {
  let onset: Float, offset: Float
  let minimumOnFrames: Int, minimumOffFrames: Int
  init() { onset=0.5; offset=0.5; minimumOnFrames=2; minimumOffFrames=4 }
  init(onset:Float,offset:Float,minimumOnFrames:Int,minimumOffFrames:Int) throws {
    guard onset.isFinite,offset.isFinite,(0.05...0.95).contains(onset),(0.05...0.95).contains(offset),
      (1...8).contains(minimumOnFrames),(1...8).contains(minimumOffFrames) else { throw Invalid.parameters }
    self.onset=onset; self.offset=offset; self.minimumOnFrames=minimumOnFrames; self.minimumOffFrames=minimumOffFrames
  }
  var json: [String:Any] { ["onset":onset,"offset":offset,"minimumOnFrames":minimumOnFrames,
    "minimumOffFrames":minimumOffFrames,"frameMs":80] }
  static func fromJson(_ value:Any?) throws -> Self {
    guard let value else { return .init() }
    guard let map=value as? [String:Any],Set(map.keys).isSubset(of:["onset","offset","minimumOnFrames","minimumOffFrames","frameMs"]),
      map["frameMs"] == nil || map["frameMs"] as? Int == 80,
      let onset=map["onset"] as? NSNumber,let offset=map["offset"] as? NSNumber,
      let on=map["minimumOnFrames"] as? Int,let off=map["minimumOffFrames"] as? Int else { throw Invalid.parameters }
    return try .init(onset:onset.floatValue,offset:offset.floatValue,minimumOnFrames:on,minimumOffFrames:off)
  }
  enum Invalid: Error { case parameters }
}

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
  private let configuration: DeviceSpeakerActivityConfiguration
  init(configuration:DeviceSpeakerActivityConfiguration = .init()) { self.configuration=configuration }

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
        if state == nil, p >= configuration.onset { state = Active(start:frame) }
        else if var current = state {
          if !current.confirmed, p < configuration.onset { state = nil }
          else if let off = current.off {
            if frame-off >= configuration.minimumOffFrames { state = p >= configuration.onset ? Active(start:frame) : nil }
            else if p >= configuration.onset {
              current.off = nil; state = current
              mark(speaker,from:off,confidence:current.sum/Float(max(1,current.count)))
            }
          } else if p < configuration.offset { current.off = frame; state = current }
        }
        if var current = state, current.off == nil {
          current.count += 1; current.sum += p
          let wasConfirmed = current.confirmed
          current.confirmed = current.confirmed || current.count >= configuration.minimumOnFrames
          if current.confirmed {
            mark(speaker,from:wasConfirmed ? frame : current.start,confidence:current.sum/Float(current.count))
          }
          state = current
        }
        active[speaker] = state
      }
      if pending.count > max(configuration.minimumOnFrames,configuration.minimumOffFrames) {
        output.append(contentsOf:pending.removeFirst().values); emitted += 1
      }
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
