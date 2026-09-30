import AVFoundation
import Flutter
import Foundation

/// Uses the original 1.0 input, converter and coordinator. No model is started.
/// Only spoken public iOS selects this owner; all other input paths are unchanged.
final class PublicPcmCaptureBridge: NSObject, FlutterStreamHandler {
  private let coordinator: AudioSessionCoordinator
  private var sink: FlutterEventSink?
  private var input: CoreMlNemotronAudioInput?
  private var captureId: String?
  private var mailbox: PublicPcmMailbox?
  private let trace = CoreMlNemotronDiagnosticRecorder(metadataOnly: true, maximumTimelineEvents: 4096)
  private var tracing = false
  private var pendingStart: (id:String,result:FlutterResult)?
  private var startTimeout: DispatchWorkItem?
  let renderReference = PcmRenderReference()
  private var productSessionId: String?
  private var renderGeneration: UInt64 = 0
  private var waveformQaUsed = false
  private var waveformInput: CoreMlNemotronDiagnosticRecorder?
  private var waveformOutput: CoreMlNemotronDiagnosticRecorder?
  var hasCapture: Bool { captureId != nil }

  init(coordinator: AudioSessionCoordinator) { self.coordinator = coordinator }
  func register(messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name: "translation_mobile/public_pcm_capture", binaryMessenger: messenger)
      .setMethodCallHandler { [weak self] call, result in self?.handle(call, result) }
    FlutterEventChannel(name: "translation_mobile/public_pcm_capture/events", binaryMessenger: messenger)
      .setStreamHandler(self)
  }
  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    guard !hasCapture, let args = arguments as? [String:Any], let id = args["captureId"] as? String,
      !id.isEmpty, id.count <= 120 else { return error("invalid_public_capture_listener") }
    sink = events
    events(["captureId":id,"ready":true])
    return nil
  }
  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    stop(); sink = nil; return nil
  }
  private func handle(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    guard let args = call.arguments as? [String: Any], let id = args["captureId"] as? String,
      !id.isEmpty, id.count <= 120 else { result(error("invalid_public_capture")); return }
    var starting = false
    do {
      if call.method == "start" {
        guard !hasCapture, sink != nil, microphoneGranted,
          let rate = args["sampleRate"] as? Int, [16000,24000].contains(rate),
          let duration = args["frameDurationMs"] as? Int, (10...100).contains(duration)
          else { throw failure("public_capture_not_ready") }
        productSessionId = args["productSessionId"] as? String
        renderGeneration = renderReference.reset(sessionId:productSessionId,sampleRate:rate)
        let renderTap = PcmRenderTap(reference:renderReference,generation:renderGeneration)
        let input = CoreMlNemotronAudioInput(audioSessionCoordinator: coordinator,
          owner: "public_pcm_capture", sampleRate: Double(rate), sharedPlaybackReference: true,
          configurationChanged: { [weak self] state in
            guard let self, self.captureId == id else { return }
            self.record("capture.engine_configuration_change", state)
          },recoverSharedConfiguration:true,renderTap:renderTap)
        let mailbox = PublicPcmMailbox()
        self.input = input; captureId = id; starting = true; self.mailbox = mailbox
        startWaveformQaIfRequested(captureId:id,sampleRate:rate)
        let waveformInput = self.waveformInput
        if let session = args["diagnosticSessionId"] as? String, !session.isEmpty, session.count <= 240 {
          tracing = true
          trace.start(enabled: true, sessionId: "public-pcm-" + id,
            configuration: ["kind":"public_pcm_reference_metadata", "productSessionId":session,
              "captureId":id,"sampleRate":rate,"pcmCaptured":false], modelDirectory:nil)
        }
        try input.start(chunkDurationMs: duration, onRuntimeError: { [weak self] code, message in
          mailbox.fail(code)
          DispatchQueue.main.async {
            guard let self, self.captureId == id else { return }
            let error = FlutterError(code:code,message:message,details:nil)
            if self.pendingStart != nil { self.finishStart(error) }
            else { self.sink?(error) }
            self.stop()
          }
        }, onChunk: { [weak self] samples in
          let pcm = VoiceProcessingPcmPlayer.encode(samples)
          mailbox.append(pcm)
          waveformInput?.appendPcm16(pcm)
          DispatchQueue.main.async {
            guard let self, self.captureId == id else { return }
            if self.pendingStart != nil, let input = self.input, input.pcmReadiness.ready {
              let readiness = input.pcmReadiness
              self.record("capture.ready_after_first_pcm",["input":input.payload(),"readiness":readiness.payload])
              self.finishStart(["captureId":id,"sampleRate":rate,"voiceProcessingEnabled":readiness.ready,
                "readiness":readiness.payload,"sharedPlaybackReference":true,"firstPcmReady":true])
            }
            if self.pendingStart == nil { self.drain(mailbox, id:id) }
          }
        })
        let audio = AVAudioSession.sharedInstance()
        let readiness = input.pcmReadiness
        record("capture.starting",
          ["input":input.payload(),"readiness":readiness.payload,"mode":audio.mode.rawValue,
          "inputs":audio.currentRoute.inputs.map { $0.portType.rawValue },
          "outputs":audio.currentRoute.outputs.map { $0.portType.rawValue }])
        pendingStart = (id,result)
        let timeout = DispatchWorkItem { [weak self] in
          guard let self, self.captureId == id, self.pendingStart?.id == id else { return }
          self.finishStart(self.error("public_capture_first_pcm_timeout"));self.stop()
        }
        startTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline:.now()+3,execute:timeout)
        return
      }
      // A late stop from an older Dart generation must not stop a new capture.
      guard captureId == id else {
        if call.method == "stop" { sink?(["captureId":id,"stopped":true]) }
        result(nil); return
      }
      switch call.method {
      case "stop":
        guard stop(drainTail:true) else { throw failure("public_capture_tail_unconfirmed") }
      case "pause": stopPlayback(); input?.pause()
      case "resume": try input?.resume()
      default: result(FlutterMethodNotImplemented); return
      }
      result(nil)
    } catch {
      if captureId == id && (call.method != "start" || starting) { stop() }
      result(FlutterError(code:"public_capture_failed",message:error.localizedDescription,details:nil))
    }
  }
  func play(_ pcm: Data, sampleRate: Int, completion: @escaping (Error?) -> Void) throws {
    guard let input, input.canPlayPcm, let output = input.pcmPlayback else { throw failure("pcm_reference_not_running") }
    let audio = AVAudioSession.sharedInstance()
    let acousticRoute = audio.currentRoute.outputs.contains { [.builtInSpeaker,.builtInReceiver].contains($0.portType) }
    let captureSample = input.payload()["convertedSamples"] as? Int ?? -1
    let generation = renderGeneration, id = captureId
    renderReference.beginPlayback(acousticRoute:acousticRoute,generation:generation)
    do { try output.play(pcm, sampleRate:sampleRate) { [weak self] error in
      if let self, self.captureId == id, self.renderGeneration == generation {
        self.renderReference.endPlayback(generation:generation)
        self.record("tts.end", ["completion":error == nil ? "finished" : "cancelled",
          "renderReference":self.renderReference.metadata])
      }
      completion(error)
    } } catch {
      renderReference.endPlayback(generation:generation)
      record("tts.end",["completion":"failed","renderReference":renderReference.metadata])
      throw error
    }
    let qaPcm = waveformOutput == nil ? Data() : PublicAudioWaveformQa.outputWithinWindow(pcm,
      captureSample:captureSample,sampleRate:sampleRate)
    if !qaPcm.isEmpty, let waveformOutput {
      let offset = waveformOutput.payload()["currentAudioSamples"] as? Int ?? 0
      waveformOutput.appendPcm16(qaPcm)
      waveformOutput.record(type:"tts.source",payload:["captureSample":captureSample,
        "sourceStartSample":offset,"sourceEndSample":offset+qaPcm.count/2,"sampleRate":sampleRate])
    }
    record("tts.begin", ["sampleRate":sampleRate,"bytes":pcm.count,"sharedPlaybackReference":true,
      "captureSample":captureSample,"acousticRoute":acousticRoute,"renderReference":renderReference.metadata])
  }
  func stopPlayback() {
    renderReference.endPlayback(generation:renderGeneration)
    input?.pcmPlayback?.stop()
  }
  @discardableResult private func drain(_ mailbox: PublicPcmMailbox, id: String) -> Bool {
    let batch = mailbox.take()
    if let code = batch.errorCode { sink?(error(code)); return false }
    for data in batch.frames { sink?(["captureId":id,"data":FlutterStandardTypedData(bytes:data)]) }
    return true
  }
  @discardableResult private func stop(drainTail: Bool = false) -> Bool {
    if pendingStart != nil { finishStart(error("public_capture_start_cancelled")) }
    let id = captureId
    var confirmed = true
    let tail = input?.stop(flushPending:drainTail) ?? []
    if drainTail, let id, let mailbox {
      let pcm = VoiceProcessingPcmPlayer.encode(tail)
      mailbox.append(pcm);waveformInput?.appendPcm16(pcm);confirmed = drain(mailbox,id:id)
      sink?(["captureId":id,"stopped":true])
    }
    captureId = nil; mailbox = nil
    if let input { record("capture.stop", input.payload()) }
    input = nil
    productSessionId = nil
    renderReference.reset(sessionId:nil,sampleRate:16000)
    if tracing { trace.finish(); tracing = false }
    waveformInput?.finish();waveformOutput?.finish()
    waveformInput = nil;waveformOutput = nil
    return confirmed
  }

  private func startWaveformQaIfRequested(captureId:String,sampleRate:Int) {
    guard !waveformQaUsed, sampleRate == 16000,
      let request = PublicAudioWaveformQa.requested(environment:ProcessInfo.processInfo.environment,
        sourceCommit:Bundle.main.object(forInfoDictionaryKey:"WujieSourceCommit") as? String,
        bundleId:Bundle.main.bundleIdentifier),let productSessionId else { return }
    waveformQaUsed = true
    let settings:[String:Any] = ["kind":"public_audio_waveform_qa","run":request.run,
      "productSessionId":productSessionId,"captureId":captureId,"sampleRate":16000,
      "maximumSeconds":30,"storage":"local_device_only","affectsLiveAudio":false]
    let input = CoreMlNemotronDiagnosticRecorder(maximumTimelineEvents:100,maximumAudioSeconds:30)
    let output = CoreMlNemotronDiagnosticRecorder(maximumTimelineEvents:100,maximumAudioSeconds:30)
    input.start(enabled:true,sessionId:"qa-input-"+request.run,configuration:settings,modelDirectory:nil)
    output.start(enabled:true,sessionId:"qa-tts-"+request.run,configuration:settings,modelDirectory:nil)
    waveformInput = input;waveformOutput = output
  }
  private func finishStart(_ response:Any?) {
    let start = pendingStart;pendingStart = nil
    startTimeout?.cancel();startTimeout = nil
    start?.result(response)
  }
  private func record(_ type: String, _ payload: [String:Any]) {
    if tracing { trace.record(type:type,payload:payload) }
  }
  private func error(_ code:String) -> FlutterError { FlutterError(code:code,message:code,details:nil) }
  private var microphoneGranted: Bool {
    if #available(iOS 17.0, *) { return AVAudioApplication.shared.recordPermission == .granted }
    return AVAudioSession.sharedInstance().recordPermission == .granted
  }
  private func failure(_ code:String) -> NSError {
    NSError(domain:"PublicPcmCapture",code:1,userInfo:[NSLocalizedDescriptionKey:code])
  }
}
