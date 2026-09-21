import CoreML
import Flutter
import Foundation

/// Original App plugin: accepts supplied PCM only. It never requests the mic.
final class DeviceSpeakerBridge: NSObject, FlutterStreamHandler {
  private var sink: FlutterEventSink?
  private var model: MLModel?
  private var engine: DeviceSpeakerEngine?
  private var sessionId: String?
  private var preparationId: String?
  private var chain: Task<Void, Never>?
  private var receivedSamples = 0, queuedSamples = 0, sampleRate = 16000

  func register(messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name: "translation_mobile/device_speaker", binaryMessenger: messenger)
      .setMethodCallHandler { [weak self] call, result in
        Task { @MainActor in await self?.handle(call, result: result) }
      }
    FlutterEventChannel(name: "translation_mobile/device_speaker/events", binaryMessenger: messenger)
      .setStreamHandler(self)
  }
  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? { sink = events; return nil }
  func onCancel(withArguments arguments: Any?) -> FlutterError? { sink = nil; return nil }

  @MainActor
  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) async {
    let args = call.arguments as? [String: Any] ?? [:]
    do {
      switch call.method {
      case "prepare":
        guard sessionId == nil else { throw DeviceSpeakerFailure.busy }
        guard let id = args["requestId"] as? String, !id.isEmpty, id.count <= 120 else { throw DeviceSpeakerFailure.invalidAudio }
        preparationId = id
        if model == nil {
          let loaded = try await Task.detached(priority: .userInitiated) { try DeviceSpeakerModelResources.load() }.value
          guard preparationId == id else { throw DeviceSpeakerFailure.cancelled }
          model = loaded
        }
        result(["ready": true, "profile": DeviceSpeakerModelResources.profile, "modelRevision": DeviceSpeakerModelResources.revision, "maxSpeakers": 4])
      case "cancelPreparation":
        if preparationId == args["requestId"] as? String { preparationId = nil }
        result(nil)
      case "start":
        guard let id = args["sessionId"] as? String, let rate = args["sampleRate"] as? Int,
          let model, sessionId == nil else { throw DeviceSpeakerFailure.busy }
        engine = try DeviceSpeakerEngine(sessionId: id, sampleRate: rate, model: model)
        sessionId = id; sampleRate = rate; receivedSamples = 0; queuedSamples = 0; chain = nil
        result(["sessionId": id, "ready": true])
      case "accept":
        guard let id = args["sessionId"] as? String, id == sessionId, let current = engine,
          let start = args["startSample"] as? Int, start == receivedSamples,
          let data = args["pcm"] as? FlutterStandardTypedData, !data.data.isEmpty,
          data.data.count % 2 == 0, data.data.count <= sampleRate * 2 else { throw DeviceSpeakerFailure.invalidAudio }
        let count = data.data.count / 2
        guard queuedSamples + count <= sampleRate * 3 else { throw DeviceSpeakerFailure.backpressure }
        receivedSamples += count; queuedSamples += count
        let previous = chain
        chain = Task { @MainActor [weak self] in
          await previous?.value
          guard let self, self.sessionId == id else { return }
          defer { if self.sessionId == id { self.queuedSamples = max(0, self.queuedSamples - count) } }
          do {
            let values = try await current.accept(data.data, startSample: start)
            guard self.sessionId == id else { return }
            for value in values { self.sink?(value.json) }
          } catch {
            guard self.sessionId == id else { return }
            self.sink?(["type": "speaker.unavailable", "sessionId": id,
              "code": (error as? DeviceSpeakerFailure)?.rawValue ?? "device_speaker_inference_failed"])
            self.sessionId = nil; self.engine = nil
            await current.cancel()
          }
        }
        result(nil)
      case "finish":
        guard let id = args["sessionId"] as? String, id == sessionId, let current = engine else { throw DeviceSpeakerFailure.cancelled }
        await chain?.value
        guard sessionId == id else { throw DeviceSpeakerFailure.cancelled }
        let final = try await current.finish()
        guard sessionId == id else { throw DeviceSpeakerFailure.cancelled }
        sessionId = nil; engine = nil; chain = nil
        // Returning the final packet also avoids relying on ordering between
        // Flutter's method and event channels at the stop barrier.
        result(["sessionId": id, "evidence": final.map(\.json), "diagnostics": await current.diagnostics()])
      case "cancel":
        if let id = args["sessionId"] as? String, sessionId == id {
          let old = engine; sessionId = nil; engine = nil; chain = nil
          Task { await old?.cancel() }
        }
        result(nil)
      default: result(FlutterMethodNotImplemented)
      }
    } catch {
      result(FlutterError(code: (error as? DeviceSpeakerFailure)?.rawValue ?? "device_speaker_failed",
        message: "手机说话人识别暂不可用，转写和翻译可继续。", details: nil))
    }
  }
}
