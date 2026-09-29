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
    stop()
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
