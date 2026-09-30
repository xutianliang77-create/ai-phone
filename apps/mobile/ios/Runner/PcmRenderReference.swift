import Foundation

/// A bounded, ephemeral reference of what THIS capture actually rendered.
/// High waveform agreement is echo evidence, not text matching or a language
/// decision. Independent double-talk is retained; unmatched/partial evidence
/// is never enough to reject input. No PCM is persisted or sent to the server.
final class PcmRenderReference {
  struct Match {
    let matched: Bool, correlation: Double; let lagMs: Int, coverage: Double
    let requiresEchoProof: Bool, referenceKnown: Bool
    init(matched: Bool, correlation: Double, lagMs: Int, coverage: Double = 0,
      requiresEchoProof: Bool = false, referenceKnown: Bool = true) {
      self.matched = matched; self.correlation = correlation
      self.lagMs = lagMs; self.coverage = coverage
      self.requiresEchoProof = requiresEchoProof; self.referenceKnown = referenceKnown
    }
  }
  private let lock = NSLock()
  private let rate = 2000, capacity = 16000 // 8 seconds, 64 KB float reference
  private var values = [Float](repeating: 0, count: 16000)
  private var positions = [Int](repeating: -1, count: 16000)
  private var owner: String?
  private var captureRate = 16000
  private var latestRecordedEnd = -1
  private var generation: UInt64 = 0
  private var clock = PcmRenderClock()
  private var renderClock = PcmRenderSampleClock()
  private var acousticRoute = false, playbackActive = false
  private var physicalClock = false
  private var tailEndSample = 0, renderedBuffers = 0
  private var renderedThrough = -Double.infinity
  private var partialBin = -1, partialSum = 0.0, partialCoverage = 0.0

  @discardableResult func reset(sessionId: String?, sampleRate: Int) -> UInt64 {
    lock.lock(); defer { lock.unlock() }
    generation &+= 1
    owner = sessionId; captureRate = sampleRate
    values = [Float](repeating:0,count:capacity)
    positions = [Int](repeating: -1, count: capacity)
    latestRecordedEnd = -1
    clock = PcmRenderClock(); acousticRoute = false; playbackActive = false
    renderClock = PcmRenderSampleClock()
    physicalClock = false
    tailEndSample = 0; renderedBuffers = 0
    renderedThrough = -Double.infinity; partialBin = -1; partialSum = 0; partialCoverage = 0
    return generation
  }

  func observeInput(endSample: Int, endTime: Double, generation expected: UInt64) {
    lock.lock(); defer { lock.unlock() }
    guard generation == expected, owner != nil else { return }
    physicalClock = true
    if clock.observeInput(endSample:endSample,endTime:endTime,sampleRate:captureRate) {
      renderClock = PcmRenderSampleClock()
      values = [Float](repeating:0,count:capacity)
      positions = [Int](repeating:-1,count:capacity); latestRecordedEnd = -1
      renderedBuffers = 0
      renderedThrough = -Double.infinity; partialBin = -1; partialSum = 0; partialCoverage = 0
    }
  }

  func invalidateClock(generation expected: UInt64) {
    lock.lock(); defer { lock.unlock() }
    guard generation == expected else { return }
    clock = PcmRenderClock(); renderedBuffers = 0
    renderClock = PcmRenderSampleClock()
    values = [Float](repeating:0,count:capacity); positions = [Int](repeating:-1,count:capacity)
    latestRecordedEnd = -1; renderedThrough = -Double.infinity
    partialBin = -1; partialSum = 0; partialCoverage = 0
  }

  func recordRendered(_ samples: [Float], sampleRate: Double, hostTime: Double,
    generation expected: UInt64, sampleTime: Int64? = nil) {
    guard sampleRate.isFinite, sampleRate >= Double(rate), !samples.isEmpty else { return }
    lock.lock(); defer { lock.unlock() }
    guard generation == expected, owner != nil, clock.ready,
      let stamp = renderClock.stamp(sampleTime:sampleTime,sampleRate:sampleRate,frames:samples.count,hostTime:hostTime),
      let captureStart = clock.position(at:stamp.hostTime,sampleRate:captureRate) else { return }
    if stamp.discontinuity {
      values = [Float](repeating:0,count:capacity); positions = [Int](repeating:-1,count:capacity)
      latestRecordedEnd = -1; renderedBuffers = 0; renderedThrough = -Double.infinity
      partialBin = -1; partialSum = 0; partialCoverage = 0
    }
    let start = captureStart * Double(rate) / Double(captureRate)
    let end = start + Double(samples.count) * Double(rate) / sampleRate
    guard start >= 0, end < Double(Int.max), end > renderedThrough else { return }
    // Accumulate the two real portions of a bin split by adjacent tap
    // buffers. Dropping fractional edges creates an artificial hole every
    // 100 ms; filling a genuinely missing callback with zero is equally wrong.
    let from = Int(floor(max(start,renderedThrough))), through = Int(ceil(end))
    for p in max(from,through-capacity)..<through {
      let lo = max(Double(p),start,renderedThrough), hi = min(Double(p+1),end)
      guard hi > lo else { continue }
      if p != partialBin { partialBin = p; partialSum = 0; partialCoverage = 0 }
      let a = (lo-start)*sampleRate/Double(rate)
      let b = (hi-start)*sampleRate/Double(rate)
      var sum = 0.0
      for k in Int(floor(a))..<min(samples.count,Int(ceil(b))) {
        let weight = max(0,min(b,Double(k+1))-max(a,Double(k)))
        let value = samples[k].isFinite ? Double(samples[k]) : 0
        sum += value*weight
      }
      partialSum += sum*Double(rate)/sampleRate; partialCoverage += hi-lo
      // 1e-4 bin is 50 ns, only host-clock floating-point/tick rounding.
      // An audible or lost-buffer gap never becomes a known reference bin.
      if partialCoverage >= 1-1e-4 {
        let slot = p % capacity
        values[slot] = Float(partialSum/partialCoverage); positions[slot] = p
      }
    }
    renderedThrough = end
    latestRecordedEnd = max(latestRecordedEnd,through); renderedBuffers += 1
  }

  func beginPlayback(acousticRoute: Bool, generation expected: UInt64) {
    lock.lock(); defer { lock.unlock() }
    guard generation == expected else { return }
    self.acousticRoute = acousticRoute; playbackActive = true
  }
  func updateRoute(acoustic: Bool, generation expected: UInt64) {
    lock.lock(); defer { lock.unlock() }
    guard generation == expected else { return }
    acousticRoute = acoustic
  }
  func endPlayback(generation expected: UInt64) {
    lock.lock(); defer { lock.unlock() }
    guard generation == expected else { return }
    playbackActive = false
    tailEndSample = Int(Double(clock.inputEndSample)*16000/Double(captureRate)) + 5600
  }
  var clockReady: Bool { lock.lock(); defer { lock.unlock() }; return clock.ready && renderedBuffers > 0 }
  var inputClockReady: Bool { lock.lock(); defer { lock.unlock() }; return clock.ready }
  var metadata: [String:Any] {
    lock.lock(); defer { lock.unlock() }
    return ["source":"main_mixer_host_clock","clockReady":clock.ready && renderedBuffers > 0,
      "inputClockAnchored":clock.ready,
      "renderedBuffers":renderedBuffers,"latestReferenceSample":latestRecordedEnd,
      "captureRate":captureRate,"acousticRoute":acousticRoute,"renderClock":renderClock.metadata]
  }

  // Pure offline fixtures only. Production records the mixer tap instead.
  func record(_ pcm: Data, sampleRate: Int, captureSample: Int, sessionId: String?, acousticRoute: Bool) {
    guard acousticRoute, let sessionId, [16000,24000].contains(sampleRate), pcm.count.isMultiple(of:2), !pcm.isEmpty else { return }
    lock.lock(); defer { lock.unlock() }
    guard owner == sessionId, [16000,24000].contains(captureRate), captureSample >= 0 else { return }
    let bytes = [UInt8](pcm), stride = sampleRate / rate, start = captureSample / (captureRate / rate)
    let count = min(capacity, pcm.count / 2 / stride)
    for i in 0..<count {
      var sum: Float = 0
      for j in 0..<stride {
        let k = (i * stride + j) * 2
        sum += Float(Int16(bitPattern:UInt16(bytes[k]) | UInt16(bytes[k+1]) << 8)) / 32768
      }
      let p = start + i, slot = p % capacity
      values[slot] = sum / Float(stride); positions[slot] = p
    }
    latestRecordedEnd = max(latestRecordedEnd,start + count)
  }
  func match(_ samples: [Float], analysisStart: Int, sessionId: String?) -> Match {
    guard let sessionId, samples.count >= 1024, analysisStart >= 0 else { return Match(matched:false,correlation:0,lagMs:0) }
    let stride = 8, count = samples.count / 8
    var input = [Double](repeating:0,count:count)
    for i in 0..<count { for j in 0..<stride { input[i] += Double(samples[i*stride+j]) / Double(stride) } }
    let mean = input.reduce(0,+) / Double(count)
    for i in 0..<count { input[i] -= mean }
    lock.lock()
    guard owner == sessionId else { lock.unlock(); return Match(matched:false,correlation:0,lagMs:0) }
    if physicalClock && !acousticRoute {
      lock.unlock(); return Match(matched:false,correlation:0,lagMs:0,referenceKnown:true)
    }
    let values = self.values, positions = self.positions, latestRecordedEnd = self.latestRecordedEnd
    let requiresProof = acousticRoute && (playbackActive || analysisStart < tailEndSample)
    lock.unlock() // Never hold the tap's reference lock through the correlation scan.
    let energy = input.reduce(0) { $0+$1*$1 }
    guard energy > 1e-9 else {
      return Match(matched:false,correlation:0,lagMs:0,requiresEchoProof:requiresProof,referenceKnown:false)
    }
    let base = analysisStart / stride
    // Reuse the 1.0 echo-tail bound for uncertain hardware/render alignment.
    let maxLag = 350 * rate / 1000 // the unchanged 1.0 350 ms echo-tail bound
    // Streaming TTS schedules the next PCM block after the preceding playback
    // callback. A 90-105 ms reference gap may cross a 256 ms VAD frame. Score
    // only a sufficiently long contiguous rendered portion of that frame;
    // never fill the gap with invented samples or treat a short overlap as echo.
    let minimumRun = count >= 512 ? (count * 55 + 99) / 100 : count
    if latestRecordedEnd < base - maxLag + minimumRun {
      return Match(matched:false,correlation:0,lagMs:0,requiresEchoProof:requiresProof,referenceKnown:false)
    }
    var best = 0.0, lag = 0, covered = 0, known = 0
    func score(_ n: Int, _ sumR: Double, _ sumI: Double,
      _ squaresR: Double, _ squaresI: Double, _ product: Double) -> Double {
      guard n >= minimumRun else { return 0 }
      let length = Double(n)
      let referenceEnergy = squaresR - sumR * sumR / length
      let inputEnergy = squaresI - sumI * sumI / length
      guard referenceEnergy > 1e-9, inputEnergy > 1e-9 else { return 0 }
      return min(1, abs(product - sumR * sumI / length) /
        sqrt(referenceEnergy * inputEnergy))
    }
    for offset in -maxLag...maxLag {
      let start = base + offset
      if start < 0 { continue }
      var n = 0, sumR = 0.0, sumI = 0.0, squaresR = 0.0
      var squaresI = 0.0, product = 0.0
      func considerRun() {
        known = max(known,n)
        let correlation = score(n,sumR,sumI,squaresR,squaresI,product)
        if correlation > best { best = correlation; lag = offset * 1000 / rate; covered = n }
      }
      for i in 0..<count {
        let p = start + i, slot = p % capacity
        if positions[slot] != p {
          considerRun();n = 0;sumR = 0;sumI = 0;squaresR = 0;squaresI = 0;product = 0
          continue
        }
        let x = Double(values[slot]), y = input[i]
        n += 1;sumR += x;sumI += y;squaresR += x*x;squaresI += y*y;product += x*y
      }
      considerRun()
    }
    // The same-phone false turn had 0.497 correlation after voice processing,
    // while independent near speech in the bounded double-talk replay stayed
    // below 0.46. This is direct waveform evidence, never text/locale matching.
    return Match(matched:best >= 0.46,correlation:best,lagMs:lag,
      coverage:Double(covered)/Double(count),requiresEchoProof:requiresProof,referenceKnown:known >= count)
  }
}
