import Foundation

/// Converts actual I/O host timestamps to the existing, unchanged capture
/// sample axis. Queue wait and player.schedule() time are never clock inputs.
struct PcmRenderClock {
  private(set) var inputEndSample = 0
  private var inputEndTime: Double?
  private var originSample = 0, originTime = 0.0
  private var earliestRenderTime = Double.infinity
  var ready: Bool { inputEndTime != nil }

  mutating func observeInput(endSample: Int, endTime: Double, sampleRate: Int) -> Bool {
    guard endSample > inputEndSample, endTime.isFinite, endTime > 0,
      sampleRate > 0, inputEndTime.map({ endTime > $0 }) ?? true else { return false }
    let discontinuity: Bool
    if let previous = inputEndTime {
      // A pause/route gap is a new hardware-clock segment, not missing PCM
      // that may be invented or replayed. 50 ms is timestamp continuity
      // tolerance, not a VAD/voice-energy or barge-in threshold.
      discontinuity = abs(Double(endSample-inputEndSample)/Double(sampleRate) - (endTime-previous)) > 0.05
    } else { discontinuity = true }
    inputEndSample = endSample; inputEndTime = endTime
    if discontinuity {
      earliestRenderTime = endTime; originSample = endSample; originTime = endTime
    }
    return discontinuity
  }

  func position(at time: Double, sampleRate: Int) -> Double? {
    guard time.isFinite, time >= earliestRenderTime, inputEndTime != nil, sampleRate > 0 else { return nil }
    // Use the segment origin, not each rounded converter-buffer end. Updating
    // the affine origin per packet would jitter reference bins by a sample.
    let sample = Double(originSample) + (time-originTime)*Double(sampleRate)
    return sample.isFinite && sample >= 0 ? sample : nil
  }
}

enum PcmPlaybackBoundary {
  /// The original private player still resets. Public, fully completed
  /// streaming chunks must not reset the live AVAudioPlayerNode between chunks.
  static func shouldStopBeforePlay(publicCapture: Bool, pendingResult: Bool,
    privatePlayer: Bool, playbackId: Bool) -> Bool {
    !publicCapture || pendingResult || privatePlayer || playbackId
  }
}
