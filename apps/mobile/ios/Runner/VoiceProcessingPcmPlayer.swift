import AVFoundation
import Foundation

struct PcmCaptureReadiness {
  let inputStarted: Bool, engineRunning: Bool, referenceBound: Bool
  let inputProcessing: Bool, outputProcessing: Bool, bypassed: Bool
  var reason: String? {
    if !inputStarted { return "input_not_started" }
    if !engineRunning { return "engine_not_running" }
    if !referenceBound { return "playback_reference_missing" }
    if !inputProcessing { return "input_voice_processing_disabled" }
    if !outputProcessing { return "output_voice_processing_disabled" }
    if bypassed { return "voice_processing_bypassed" }
    return nil
  }
  var ready: Bool { reason == nil }
  var payload: [String: Any] {
    ["inputStarted":inputStarted,"engineRunning":engineRunning,"referenceBound":referenceBound,
      "inputProcessing":inputProcessing,"outputProcessing":outputProcessing,"bypassed":bypassed,
      "ready":ready,"reason":reason ?? "ready"]
  }
}

protocol VoiceProcessingPcmNode: AnyObject {
  func schedule(_ buffer: AVAudioPCMBuffer, completion: @escaping () -> Void)
  func play()
  func stop()
}

private final class EnginePcmNode: VoiceProcessingPcmNode {
  let node = AVAudioPlayerNode()
  func schedule(_ buffer: AVAudioPCMBuffer, completion: @escaping () -> Void) {
    node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { _ in
      DispatchQueue.main.async(execute: completion)
    }
  }
  func play() { node.play() }
  func stop() { node.stop() }
}

/// The output node belongs to the SAME voice-processing engine as the mic.
/// Cancelling one output never pauses/stops the engine or the microphone tap.
final class VoiceProcessingPcmPlayer {
  private let node: VoiceProcessingPcmNode
  private let format: AVAudioFormat
  private var generation: UInt64 = 0
  private var completion: ((Error?) -> Void)?

  convenience init(engine: AVAudioEngine) throws {
    let node = EnginePcmNode()
    let rate = engine.outputNode.inputFormat(forBus: 0).sampleRate
    guard rate > 0, let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else {
      throw Self.failure("pcm_reference_format_unavailable")
    }
    engine.attach(node.node)
    engine.connect(node.node, to: engine.mainMixerNode, format: format)
    self.init(node: node, format: format)
  }

  // Pure buffer/lifecycle tests inject a node without starting physical I/O.
  init(node: VoiceProcessingPcmNode, format: AVAudioFormat) {
    self.node = node; self.format = format
  }

  func play(_ pcm: Data, sampleRate: Int, completion: @escaping (Error?) -> Void) throws {
    let buffer = try Self.buffer(pcm, sampleRate: sampleRate, output: format)
    // A fully played preceding chunk has no pending completion. Do not stop
    // and restart the reference node between normal streaming chunks.
    if self.completion != nil { stop() }
    generation &+= 1
    let current = generation
    self.completion = completion
    node.schedule(buffer) { [weak self] in
      guard let self, self.generation == current else { return }
      let done = self.completion
      self.completion = nil
      done?(nil)
    }
    node.play()
  }

  func stop() {
    generation &+= 1
    let done = completion
    completion = nil
    node.stop()
    done?(Self.failure("pcm_audio_cancelled"))
  }

  static func encode(_ samples: [Float]) -> Data {
    var bytes = Data(capacity: samples.count * 2)
    for sample in samples {
      let value = sample.isFinite ? max(-1, min(1, sample)) : 0
      var integer = Int16(max(-32768, min(32767, Int((Double(value) * 32768).rounded())))).littleEndian
      withUnsafeBytes(of: &integer) { bytes.append(contentsOf: $0) }
    }
    return bytes
  }

  static func buffer(_ pcm: Data, sampleRate: Int, output: AVAudioFormat) throws -> AVAudioPCMBuffer {
    guard [16000, 24000].contains(sampleRate), !pcm.isEmpty, pcm.count.isMultiple(of: 2),
      pcm.count <= sampleRate * 2 * 60,
      let source = AVAudioFormat(standardFormatWithSampleRate: Double(sampleRate), channels: 1),
      let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(pcm.count / 2)),
      let channel = input.floatChannelData?[0] else { throw failure("invalid_pcm_audio") }
    let bytes = [UInt8](pcm)
    input.frameLength = input.frameCapacity
    for i in 0..<Int(input.frameLength) {
      channel[i] = Float(Int16(bitPattern: UInt16(bytes[i*2]) | UInt16(bytes[i*2+1]) << 8)) / 32768
    }
    if source == output { return input }
    guard let converter = AVAudioConverter(from: source, to: output),
      let result = AVAudioPCMBuffer(pcmFormat: output, frameCapacity:
        AVAudioFrameCount(ceil(Double(input.frameLength) * output.sampleRate / source.sampleRate)))
      else { throw failure("pcm_reference_conversion_failed") }
    converter.primeMethod = .none
    var supplied = false, error: NSError?
    converter.convert(to: result, error: &error) { _, status in
      guard !supplied else { status.pointee = .endOfStream; return nil }
      supplied = true; status.pointee = .haveData; return input
    }
    if let error { throw error }
    guard result.frameLength > 0 else { throw failure("pcm_reference_conversion_empty") }
    return result
  }

  private static func failure(_ code: String) -> NSError {
    NSError(domain: "VoiceProcessingPcmPlayer", code: 1, userInfo: [NSLocalizedDescriptionKey: code])
  }
}

/// A bounded, ephemeral reference of what THIS capture actually rendered.
/// High waveform agreement is echo evidence, not text matching or a language
/// decision. Independent double-talk is retained; unmatched/partial evidence
/// is never enough to reject input. No PCM is persisted or sent to the server.
final class PcmRenderReference {
  struct Match { let matched: Bool, correlation: Double; let lagMs: Int }
  private let lock = NSLock()
  private let rate = 2000, capacity = 16000 // 8 seconds, 64 KB float reference
  private var values = [Float](repeating: 0, count: 16000)
  private var positions = [Int](repeating: -1, count: 16000)
  private var owner: String?
  private var captureRate = 16000

  func reset(sessionId: String?, sampleRate: Int) {
    lock.lock(); defer { lock.unlock() }
    owner = sessionId; captureRate = sampleRate
    values = [Float](repeating:0,count:capacity)
    positions = [Int](repeating: -1, count: capacity)
  }
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
  }
  func match(_ samples: [Float], analysisStart: Int, sessionId: String?) -> Match {
    guard let sessionId, samples.count >= 1024, analysisStart >= 0 else { return Match(matched:false,correlation:0,lagMs:0) }
    let stride = 8, count = samples.count / 8
    var input = [Double](repeating:0,count:count)
    for i in 0..<count { for j in 0..<stride { input[i] += Double(samples[i*stride+j]) / Double(stride) } }
    let mean = input.reduce(0,+) / Double(count)
    for i in 0..<count { input[i] -= mean }
    let energy = input.reduce(0) { $0+$1*$1 }
    guard energy > 1e-9 else { return Match(matched:false,correlation:0,lagMs:0) }
    lock.lock(); defer { lock.unlock() }
    guard owner == sessionId else { return Match(matched:false,correlation:0,lagMs:0) }
    let base = analysisStart / stride
    // Reuse the 1.0 echo-tail bound for uncertain hardware/render alignment.
    let maxLag = 350 * rate / 1000 // the unchanged 1.0 350 ms echo-tail bound
    var best = 0.0, lag = 0
    for offset in -maxLag...maxLag {
      let start = base + offset
      if start < 0 { continue }
      var sum = 0.0, squares = 0.0, product = 0.0, complete = true
      for i in 0..<count {
        let p = start + i, slot = p % capacity
        if positions[slot] != p { complete = false; break }
        let v = Double(values[slot]); sum += v; squares += v*v; product += v*input[i]
      }
      if !complete { continue }
      let referenceEnergy = squares - sum*sum/Double(count)
      if referenceEnergy <= 1e-9 { continue }
      let correlation = min(1,abs(product)/sqrt(referenceEnergy*energy))
      if correlation > best { best = correlation; lag = offset * 1000 / rate }
    }
    // The same-phone false turn had 0.497 correlation after voice processing,
    // while independent near speech in the bounded double-talk replay stayed
    // below 0.46. This is direct waveform evidence, never text/locale matching.
    return Match(matched:best >= 0.46,correlation:best,lagMs:lag)
  }
}
