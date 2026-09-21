import AVFoundation
import CoreML
import Foundation
#if canImport(FluidAudio)
import FluidAudio
#endif

struct DeviceSpeakerSpan: Sendable {
  let speaker: Int
  let startSample: Int
  let endSample: Int
  let confidence: Double
  let overlap: Bool
  var json: [String: Any] { ["speaker": speaker, "startSample": startSample,
    "endSample": endSample, "confidence": confidence, "overlap": overlap] }
}

struct DeviceSpeakerObservation: Sendable {
  let sessionId: String
  let sequence: Int
  let sampleRate: Int
  let throughSample: Int
  let spans: [DeviceSpeakerSpan]
  var json: [String: Any] { ["type": "speaker.evidence", "sessionId": sessionId,
    "profile": DeviceSpeakerModelResources.profile, "modelRevision": DeviceSpeakerModelResources.revision,
    "sequence": sequence, "sampleRate": sampleRate, "throughSample": throughSample,
    "spans": spans.map(\.json)] }
}

/// Pure consumer of the PCM already uploaded by the original Gateway client.
/// No AVAudioEngine, microphone, identity enrollment or network operations.
actor DeviceSpeakerEngine {
  let sessionId: String
  let sampleRate: Int
  private var inputSamples = 0, sequence = 0, through = 0
  private var cancelled = false
  private var totalProcessingMs = 0.0, maximumProcessingMs = 0.0
  private let inputFormat: AVAudioFormat
  private let outputFormat: AVAudioFormat
  private let converter: AVAudioConverter?
  #if canImport(FluidAudio)
  private let diarizer: DeviceSpeakerStreamingRuntime
  #endif

  init(sessionId: String, sampleRate: Int, model: MLModel) throws {
    guard !sessionId.isEmpty, sessionId.count <= 240, [16000, 24000].contains(sampleRate),
      let input = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: 1, interleaved: false),
      let output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)
      else { throw DeviceSpeakerFailure.invalidAudio }
    self.sessionId = sessionId; self.sampleRate = sampleRate
    inputFormat = input; outputFormat = output
    converter = sampleRate == 16000 ? nil : AVAudioConverter(from: input, to: output)
    guard sampleRate == 16000 || converter != nil else { throw DeviceSpeakerFailure.invalidAudio }
    #if canImport(FluidAudio)
    let expected: [String: [Int]] = ["chunk": [1, 112, 128], "spkcache": [1, 188, 512], "fifo": [1, 40, 512]]
    for (name, shape) in expected {
      guard model.modelDescription.inputDescriptionsByName[name]?.multiArrayConstraint?.shape.map(\.intValue) == shape else {
        throw DeviceSpeakerFailure.resourcesInvalid
      }
    }
    diarizer = try DeviceSpeakerStreamingRuntime(model:model)
    #else
    throw DeviceSpeakerFailure.unsupported
    #endif
  }

  func accept(_ data: Data, startSample: Int) throws -> [DeviceSpeakerObservation] {
    guard !cancelled, startSample == inputSamples, !data.isEmpty, data.count % 2 == 0,
      data.count <= sampleRate * 2 else { throw DeviceSpeakerFailure.invalidAudio }
    let started = ProcessInfo.processInfo.systemUptime
    defer { let ms = (ProcessInfo.processInfo.systemUptime - started) * 1000
      totalProcessingMs += ms; maximumProcessingMs = max(maximumProcessingMs, ms) }
    let bytes = [UInt8](data), count = bytes.count / 2
    guard let pcm = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(count)),
      let samples = pcm.floatChannelData?[0] else { throw DeviceSpeakerFailure.invalidAudio }
    pcm.frameLength = AVAudioFrameCount(count)
    for i in 0..<count { samples[i] = Float(Int16(bitPattern: UInt16(bytes[2*i]) | UInt16(bytes[2*i+1]) << 8)) / 32768 }
    // The inherited converter helper requires a converter; 16k PCM is already
    // the model rate and must bypass resampling, not pass a nil converter.
    let converted = sampleRate == 16000 ? (buffer: pcm, error: Optional<String>.none) :
      CoreMlNemotronAudioInput.convertPcm(buffer: pcm, converter: converter, format: outputFormat)
    guard converted.error == nil else { throw DeviceSpeakerFailure.invalidAudio }
    inputSamples += count
    #if canImport(FluidAudio)
    diarizer.addAudio(CoreMlNemotronAudioInput.floatSamples(from: converted.buffer))
    return try observations(diarizer.process())
    #else
    throw DeviceSpeakerFailure.unsupported
    #endif
  }

  func finish() throws -> [DeviceSpeakerObservation] {
    guard !cancelled else { throw DeviceSpeakerFailure.cancelled }
    let started = ProcessInfo.processInfo.systemUptime
    defer { let ms = (ProcessInfo.processInfo.systemUptime-started)*1000
      totalProcessingMs += ms; maximumProcessingMs = max(maximumProcessingMs,ms) }
    #if canImport(FluidAudio)
    var result = try observations(diarizer.finalizeSession())
    // Like 1.0, sub-80ms tails have no complete model frame. Confirm their
    // watermark without inventing a speaker label for padded audio.
    if through < inputSamples {
      through = inputSamples; sequence += 1
      result.append(DeviceSpeakerObservation(sessionId:sessionId,sequence:sequence,sampleRate:sampleRate,
        throughSample:through,spans:[]))
    }
    cancelled = true; diarizer.cleanup(); converter?.reset()
    return result
    #else
    throw DeviceSpeakerFailure.unsupported
    #endif
  }

  func cancel() {
    cancelled = true; converter?.reset()
    #if canImport(FluidAudio)
    diarizer.cleanup()
    #endif
  }
  func diagnostics() -> [String: Double] {
    ["inputSamples": Double(inputSamples), "throughSample": Double(through),
     "totalProcessingMs": totalProcessingMs, "maximumProcessingMs": maximumProcessingMs,
     "audioMs": Double(inputSamples) / Double(sampleRate) * 1000]
  }

  #if canImport(FluidAudio)
  private func observations(_ update: DiarizerChunkResult?) throws -> [DeviceSpeakerObservation] {
    guard let chunk = update else { return [] }
    var output: [DeviceSpeakerObservation] = []
    // The pinned model has 80ms frames. Use integer sample arithmetic, not a
    // rounded wall clock. Only finalized predictions can leave this device.
    for first in stride(from: 0, to: chunk.finalizedFrameCount, by: 24) {
      let last = min(first + 24, chunk.finalizedFrameCount)
      var spans: [DeviceSpeakerSpan] = []
      for frame in first..<last {
        let start = (chunk.startFrame + frame) * sampleRate * 80 / 1000
        let end = min(inputSamples, start + sampleRate * 80 / 1000)
        if start < through || end <= start { continue }
        let probabilities = (0..<4).map { Double(chunk.probability(speaker: $0, frame: frame, numSpeakers: 4)) }
        guard probabilities.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) else { throw DeviceSpeakerFailure.invalidAudio }
        let active = (0..<4).filter { probabilities[$0] >= 0.5 }
        for speaker in active { spans.append(DeviceSpeakerSpan(speaker: speaker, startSample: start,
          endSample: end, confidence: probabilities[speaker], overlap: active.count > 1)) }
      }
      let end = min(inputSamples, (chunk.startFrame + last) * sampleRate * 80 / 1000)
      guard end > through else { continue }
      through = end; sequence += 1
      output.append(DeviceSpeakerObservation(sessionId: sessionId, sequence: sequence,
        sampleRate: sampleRate, throughSample: through, spans: spans))
    }
    return output
  }
  #endif
}
