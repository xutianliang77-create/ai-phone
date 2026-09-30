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

/// AVAudioTime supplies both a host timestamp and a device sample position.
/// Anchor their relationship once per contiguous render clock. Re-anchoring
/// every buffer turns harmless host-clock drift into holes in continuous PCM.
struct PcmRenderSampleClock {
  struct Stamp { let hostTime: Double, discontinuity: Bool }
  private var anchorSample: Int64?, anchorHost = 0.0, rate = 0.0
  private var lastSample: Int64?, lastEnd: Int64?, lastHost: Double?
  private var sampleBuffers = 0, hostOnlyBuffers = 0, discontinuities = 0, gaps = 0
  private var maxHostDriftMs = 0.0

  mutating func stamp(sampleTime: Int64?, sampleRate: Double, frames: Int,
    hostTime: Double) -> Stamp? {
    guard sampleRate.isFinite, sampleRate >= 2000, frames > 0,
      hostTime.isFinite, hostTime > 0, lastHost.map({ hostTime > $0 }) ?? true else { return nil }
    guard let sampleTime else {
      let changed = anchorSample != nil
      anchorSample = nil; lastSample = nil; lastEnd = nil; lastHost = hostTime
      hostOnlyBuffers += 1
      if changed { discontinuities += 1 }
      return Stamp(hostTime:hostTime,discontinuity:changed)
    }
    let next = sampleTime.addingReportingOverflow(Int64(frames))
    guard !next.overflow else { return nil }
    if sampleTime == lastSample, let lastHost, hostTime-lastHost < 0.05 { return nil }
    if let anchorSample, let lastEnd, sampleRate == rate, sampleTime >= lastEnd {
      let delta = sampleTime.subtractingReportingOverflow(anchorSample)
      guard !delta.overflow else { return nil }
      let anchored = anchorHost+Double(delta.partialValue)/rate
      let drift = abs(hostTime-anchored)
      guard anchored.isFinite else { return nil }
      maxHostDriftMs = max(maxHostDriftMs,drift*1000)
      if drift <= 0.05 {
        // A missing callback advances sampleTime too. Keep that real gap;
        // do not concatenate its neighbours or manufacture silence.
        if sampleTime > lastEnd { gaps += 1 }
        self.lastEnd = next.partialValue; lastSample = sampleTime; lastHost = hostTime
        sampleBuffers += 1
        return Stamp(hostTime:anchored,discontinuity:false)
      }
    }
    let changed = lastHost != nil
    if changed { discontinuities += 1 }
    anchorSample = sampleTime; anchorHost = hostTime; rate = sampleRate
    lastSample = sampleTime; lastEnd = next.partialValue; lastHost = hostTime
    sampleBuffers += 1
    return Stamp(hostTime:hostTime,discontinuity:changed)
  }

  var metadata: [String:Any] {
    ["basis":anchorSample == nil ? "host_only" : "sample_time_anchored_to_host",
      "sampleTimeBuffers":sampleBuffers,"hostOnlyBuffers":hostOnlyBuffers,
      "discontinuities":discontinuities,"sampleGapRanges":gaps,"maximumHostDriftMs":maxHostDriftMs]
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
