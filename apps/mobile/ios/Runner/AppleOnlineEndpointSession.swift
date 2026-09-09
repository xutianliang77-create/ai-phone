import AVFoundation
import CoreML
import Foundation
#if canImport(FluidAudio)
import FluidAudio
#endif

/// VAD-only consumer of the existing RecordAudioCapture PCM. Never owns a mic,
/// SpeechAnalyzer, translation model or network/model download operation.
@available(iOS 17.0, *)
@MainActor
final class AppleOnlineEndpointSession {
  let id: String
  private let inputFormat: AVAudioFormat
  private let outputFormat: AVAudioFormat
  private let converter: AVAudioConverter?
  private let configuration: AppleSpeechConfiguration
  private let endpoint: CoreMlNemotronEndpointDetector
  private var active = true
  private var busy = false
  private var sequence = -1
  private var pending: [Float] = []
  #if canImport(FluidAudio)
  private var vad: VadManager?
  private var state = VadStreamState.initial()
  #endif

  init(id: String, sampleRate: Int, configuration: AppleSpeechConfiguration) throws {
    guard !id.isEmpty, id.count <= 120, [16000, 24000].contains(sampleRate),
      let input = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: 1, interleaved: false),
      let output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else {
      throw AppleSpeechFailure.invalidConfiguration
    }
    self.id = id; inputFormat = input; outputFormat = output
    converter = AVAudioConverter(from: input, to: output)
    self.configuration = configuration
    endpoint = CoreMlNemotronEndpointDetector(vadThreshold: configuration.threshold,
      vadNegativeThreshold: configuration.negativeThreshold, minSpeechMs: configuration.minSpeechMs,
      endpointSilenceMs: configuration.silenceMs)
  }

  func prepare() async throws {
    #if canImport(FluidAudio)
    let config = MLModelConfiguration(); config.computeUnits = .cpuAndNeuralEngine
    // Reuse the existing exact-file hash validation. No SDK auto-download fallback.
    let model = try MLModel(contentsOf: SileroVadResources.sileroURL(), configuration: config)
    let manager = VadManager(config: VadConfig(defaultThreshold: Float(configuration.threshold), computeUnits: .cpuAndNeuralEngine), vadModel: model)
    let initial = await manager.makeStreamState()
    guard active else { throw AppleSpeechFailure.cancelled }
    vad = manager; state = initial
    #else
    throw AppleSpeechFailure.sileroMissing
    #endif
  }

  func accept(data: Data, sequence next: Int) async throws -> Bool {
    guard active, !busy, next > sequence, !data.isEmpty, data.count % 2 == 0,
      data.count <= Int(inputFormat.sampleRate) * 2 else { throw AppleSpeechFailure.invalidConfiguration }
    busy = true; defer { busy = false }
    #if canImport(FluidAudio)
    guard let vad else { throw AppleSpeechFailure.sileroMissing }
    let bytes = [UInt8](data), count = data.count / 2
    guard let pcm = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(count)),
      let channel = pcm.floatChannelData?[0] else { throw AppleSpeechFailure.invalidConfiguration }
    pcm.frameLength = AVAudioFrameCount(count)
    for i in 0..<count { channel[i] = Float(Int16(bitPattern: UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8)) / 32768 }
    let converted = CoreMlNemotronAudioInput.convertPcm(buffer: pcm, converter: converter, format: outputFormat)
    guard converted.error == nil else { throw AppleSpeechFailure.invalidConfiguration }
    pending.append(contentsOf: CoreMlNemotronAudioInput.floatSamples(from: converted.buffer))
    var ended = false
    while pending.count >= AppleSpeechConfiguration.vadFrameSamples {
      let frame = Array(pending.prefix(AppleSpeechConfiguration.vadFrameSamples))
      pending.removeFirst(AppleSpeechConfiguration.vadFrameSamples)
      let result = try await vad.processStreamingChunk(frame, state: state)
      guard active else { throw AppleSpeechFailure.cancelled }
      state = result.state
      // Feed the WHOLE 256 ms VAD window, not just the latest 40 ms capture packet.
      ended = endpoint.acceptVadFrame(probability: Double(result.probability), samples: frame,
        provider: "fluidaudio_silero").shouldFinalize || ended
    }
    sequence = next
    return ended && !endpoint.isSpeechOpen
    #else
    throw AppleSpeechFailure.sileroMissing
    #endif
  }
  func invalidate() { active = false; pending.removeAll(); converter?.reset() }
}
