import AVFoundation
import CoreML
import Foundation
import CryptoKit
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
  private let trace = CoreMlNemotronDiagnosticRecorder(metadataOnly: true, maximumTimelineEvents: 4096)
  private var tracing = false, inputSamples = 0, analysisSamples = 0
  let productSessionId: String?
  let sessionSampleOffset: Int
  var sessionAudioEndSample: Int { sessionSampleOffset + inputSamples }
  private let renderReference: PcmRenderReference?
  private var renderEchoGate = PcmRenderEchoGate()
  private var activity: AppleSpeechActivityGate
  private var evidenceFloor = 0
  private var renderEchoRanges: [Range<Int>] = []

  func startDiagnostics(sessionId: String) {
    guard !sessionId.isEmpty, sessionId.count <= 240 else { return }
    tracing = true
    trace.start(enabled: true, sessionId: "vad-" + id, configuration: [
      "kind": "online_vad_metadata", "productSessionId": sessionId, "endpointId": id,
      "inputSampleRate": Int(inputFormat.sampleRate), "parameters": configuration.parameters,
      "sessionSampleOffset": sessionSampleOffset,
      "analysisSampleRate": 16000, "pcmCaptured": false,
      "inputClock": "endpoint_capture_not_gateway", "correlateBy": "sequence_and_pcmSha256",
      "analysisMapping": inputFormat.sampleRate == 16000 ? "same_rate_cumulative_samples" : "resampler_output_clock"
    ], modelDirectory: nil)
  }
  #if canImport(FluidAudio)
  private var vad: VadManager?
  private var state = VadStreamState.initial()
  #endif

  init(id: String, sampleRate: Int, configuration: AppleSpeechConfiguration,
    productSessionId: String? = nil, renderReference: PcmRenderReference? = nil,
    sessionSampleOffset: Int = 0) throws {
    guard !id.isEmpty, id.count <= 120, [16000, 24000].contains(sampleRate),
      sessionSampleOffset >= 0,
      let input = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: 1, interleaved: false),
      let output = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else {
      throw AppleSpeechFailure.invalidConfiguration
    }
    self.id = id; inputFormat = input; outputFormat = output
    converter = AVAudioConverter(from: input, to: output)
    self.configuration = configuration
    self.productSessionId = productSessionId; self.renderReference = renderReference
    self.sessionSampleOffset = sessionSampleOffset
    activity = AppleSpeechActivityGate(preRollSamples:configuration.preRollSamples)
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

  func accept(data: Data, sequence next: Int) async throws -> (boundary: Bool, speechStarted: Bool) {
    guard active, !busy, next > sequence, !data.isEmpty, data.count % 2 == 0,
      data.count <= Int(inputFormat.sampleRate) * 2 else { throw AppleSpeechFailure.invalidConfiguration }
    busy = true; defer { busy = false }
    #if canImport(FluidAudio)
    guard let vad else { throw AppleSpeechFailure.sileroMissing }
    let bytes = [UInt8](data), count = data.count / 2
    let inputStart = inputSamples
    if tracing && inputStart == 0 {
      let audio = AVAudioSession.sharedInstance()
      trace.record(type: "audio.route", payload: ["category": audio.category.rawValue, "mode": audio.mode.rawValue,
        "hardwareSampleRate": audio.sampleRate, "inputChannels": audio.inputNumberOfChannels,
        "inputs": audio.currentRoute.inputs.map { $0.portType.rawValue },
        "outputs": audio.currentRoute.outputs.map { $0.portType.rawValue }])
    }
    guard let pcm = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(count)),
      let channel = pcm.floatChannelData?[0] else { throw AppleSpeechFailure.invalidConfiguration }
    pcm.frameLength = AVAudioFrameCount(count)
    for i in 0..<count { channel[i] = Float(Int16(bitPattern: UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8)) / 32768 }
    let converted = CoreMlNemotronAudioInput.convertPcm(buffer: pcm, converter: converter, format: outputFormat)
    guard converted.error == nil else { throw AppleSpeechFailure.invalidConfiguration }
    let convertedSamples = CoreMlNemotronAudioInput.floatSamples(from: converted.buffer)
    pending.append(contentsOf: convertedSamples)
    inputSamples += count
    if tracing { trace.record(type: "pcm.batch", payload: ["sequence": next, "startSample": inputStart,
      "endSample": inputSamples, "inputSampleRate": Int(inputFormat.sampleRate), "convertedCount": convertedSamples.count,
      "pcmSha256": SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()]) }
    var ended = false
    var started = false
    while pending.count >= AppleSpeechConfiguration.vadFrameSamples {
      let frame = Array(pending.prefix(AppleSpeechConfiguration.vadFrameSamples))
      pending.removeFirst(AppleSpeechConfiguration.vadFrameSamples)
      let result = try await vad.processStreamingChunk(frame, state: state)
      guard active else { throw AppleSpeechFailure.cancelled }
      state = result.state
      // Feed the WHOLE 256 ms VAD window, not just the latest 40 ms capture packet.
      let echo = renderReference?.match(frame,analysisStart:analysisSamples,sessionId:productSessionId)
      let rms = sqrt(frame.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(frame.count))
      let echoDecision = echo.map { renderEchoGate.evaluate($0,
        analysisStart:analysisSamples,frameSamples:frame.count,
        speechAlreadyOpen:endpoint.isSpeechOpen,inputRms:rms) } ??
        PcmRenderEchoGate.Decision(matched:false,carried:false)
      let decision = endpoint.acceptVadFrame(probability: Double(result.probability), samples: frame,
        provider: "fluidaudio_silero",speechStartAllowed:echoDecision.speechStartAllowed)
      let through = analysisSamples + frame.count
      activity.advance(through:through,speechEvent:decision.speechStarted ? (true,through) :
        decision.shouldFinalize ? (false,max(0,through-decision.trailingSilenceSamples)) : nil)
      if echoDecision.matched { renderEchoRanges.append(analysisSamples..<through) }
      evidenceFloor = max(0,through - 16000*90)
      activity.prune(before:evidenceFloor); renderEchoRanges.removeAll { $0.upperBound <= evidenceFloor }
      if tracing { trace.record(type: "vad.frame", payload: ["startSample": analysisSamples,
        "endSample": analysisSamples + frame.count, "sampleRate": 16000, "inputThroughSample": inputSamples,
        "probability": Double(result.probability), "hasSpeech": decision.hasSpeech, "rms": decision.rms,
        "speechStarted": decision.speechStarted, "finalized": decision.shouldFinalize,
        "renderEchoMatched": echoDecision.matched, "renderEchoCarried": echoDecision.carried,
        "renderResidualStartDeferred": echoDecision.residualStartDeferred,
        "renderCorrelation": echo?.correlation ?? 0,
        "renderReferenceCoverage": echo?.coverage ?? 0,
        "renderReferenceKnown": echo?.referenceKnown ?? true,
        "renderEchoProofRequired": echo?.requiresEchoProof ?? false,
        "nearSpeechStartAllowed":echoDecision.speechStartAllowed,
        "renderLagMs": echo?.lagMs ?? 0,
        "confirmedSpeechSamples": decision.confirmedSpeechSamples, "trailingSilenceSamples": decision.trailingSilenceSamples]) }
      analysisSamples += frame.count
      ended = decision.shouldFinalize || ended
      started = decision.speechStarted || started
    }
    sequence = next
    return (ended && !endpoint.isSpeechOpen, started)
    #else
    throw AppleSpeechFailure.sileroMissing
    #endif
  }
  func invalidate() {
    active = false
    activity.finish()
    renderEchoGate.reset()
    #if canImport(FluidAudio)
    vad = nil; state = VadStreamState.initial()
    #endif
    if tracing { trace.record(type: "endpoint.stop", payload: ["inputSamples": inputSamples,
      "analysisSamples": analysisSamples, "unprocessedAnalysisTail": pending.count, "lastSequence": sequence]); trace.finish(); tracing = false }
    pending.removeAll(); converter?.reset()
  }

  func audioEvidence(sessionId: String, range: [String:Any]) -> [String:Any] {
    appleOnlineAudioEvidence(sessionMatches:productSessionId == sessionId,
      inputSampleRate:Int(inputFormat.sampleRate),range:range,analysedThrough:analysisSamples,
      retainedFrom:evidenceFloor,activity:activity,renderEchoRanges:renderEchoRanges,
      sessionSampleOffset:sessionSampleOffset)
  }
}
