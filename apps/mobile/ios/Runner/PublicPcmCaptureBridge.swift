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
        let input = CoreMlNemotronAudioInput(audioSessionCoordinator: coordinator,
          owner: "public_pcm_capture", sampleRate: Double(rate), sharedPlaybackReference: true)
        let mailbox = PublicPcmMailbox()
        self.input = input; captureId = id; starting = true; self.mailbox = mailbox
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
            self.sink?(FlutterError(code: code, message: message, details: nil)); self.stop()
          }
        }, onChunk: { [weak self] samples in
          mailbox.append(VoiceProcessingPcmPlayer.encode(samples))
          DispatchQueue.main.async {
            guard let self, self.captureId == id else { return }
            self.drain(mailbox, id:id)
          }
        })
        let audio = AVAudioSession.sharedInstance()
        let readiness = input.pcmReadiness
        record(readiness.ready ? "capture.ready" : "capture.not_ready",
          ["input":input.payload(),"readiness":readiness.payload,"mode":audio.mode.rawValue,
          "inputs":audio.currentRoute.inputs.map { $0.portType.rawValue },
          "outputs":audio.currentRoute.outputs.map { $0.portType.rawValue }])
        result(["captureId":id,"sampleRate":rate,"voiceProcessingEnabled":readiness.ready,
          "readiness":readiness.payload,
          "sharedPlaybackReference":input.pcmPlayback != nil])
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
      case "pause": input?.pause()
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
    record("tts.begin", ["sampleRate":sampleRate,"bytes":pcm.count,"sharedPlaybackReference":true])
    try output.play(pcm, sampleRate:sampleRate) { [weak self] error in
      self?.record("tts.end", ["completion":error == nil ? "finished" : "cancelled"])
      completion(error)
    }
  }
  func stopPlayback() { input?.pcmPlayback?.stop() }
  @discardableResult private func drain(_ mailbox: PublicPcmMailbox, id: String) -> Bool {
    let batch = mailbox.take()
    if let code = batch.errorCode { sink?(error(code)); return false }
    for data in batch.frames { sink?(["captureId":id,"data":FlutterStandardTypedData(bytes:data)]) }
    return true
  }
  @discardableResult private func stop(drainTail: Bool = false) -> Bool {
    let id = captureId
    var confirmed = true
    let tail = input?.stop(flushPending:drainTail) ?? []
    if drainTail, let id, let mailbox {
      mailbox.append(VoiceProcessingPcmPlayer.encode(tail)); confirmed = drain(mailbox,id:id)
      sink?(["captureId":id,"stopped":true])
    }
    captureId = nil; mailbox = nil
    if let input { record("capture.stop", input.payload()) }
    input = nil
    if tracing { trace.finish(); tracing = false }
    return confirmed
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
