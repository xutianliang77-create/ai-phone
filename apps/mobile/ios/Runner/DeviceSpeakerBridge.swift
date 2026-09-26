import CoreML
import Flutter
import Foundation

/// Original App plugin: accepts supplied PCM only. It never requests the mic.
final class DeviceSpeakerBridge: NSObject, FlutterStreamHandler {
  private var sink: FlutterEventSink?
  private var model: MLModel?
  private var engine: DeviceSpeakerEngine?
  private var sessionId: String?
  private var preparationIds = Set<String>()
  private let preparation = DeviceSpeakerPreparationCache<MLModel>()
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
        preparationIds.insert(id)
        defer { preparationIds.remove(id) }
        let began = Date()
        if model == nil {
          // Rebuilding Flutter settings must not cancel another caller's load
          // or start a second expensive CoreML/ANE preparation.
          recordReadiness("loading", elapsedMs: 0)
          let loaded: MLModel
          do { loaded = try await preparation.prepare { try DeviceSpeakerModelResources.load() } }
          catch {
            recordReadiness((error as? DeviceSpeakerFailure)?.rawValue ?? "coreml_load_failed",
              elapsedMs: Int(Date().timeIntervalSince(began) * 1000), error: error)
            throw error
          }
          model = loaded
        }
        guard preparationIds.contains(id) else { throw DeviceSpeakerFailure.cancelled }
        recordReadiness("ready", elapsedMs: Int(Date().timeIntervalSince(began) * 1000))
        result(["ready": true, "profile": DeviceSpeakerModelResources.profile, "modelRevision": DeviceSpeakerModelResources.revision, "maxSpeakers": 4])
      case "cancelPreparation":
        if let id = args["requestId"] as? String { preparationIds.remove(id) }
        result(nil)
      case "recordPreparationDecision":
        if args["reason"] as? String == "waitTimedOut", let elapsed = args["elapsedMs"] as? Int, elapsed >= 0, elapsed <= 180000 {
          recordReadiness("start_wait_timed_out", elapsedMs: elapsed)
        }
        if let reason = args["reason"] as? String,
          ["selected", "server_not_offered", "client_not_available", "pending_selection_off", "local_not_ready"].contains(reason) {
          recordReadiness(reason, elapsedMs: 0)
        }
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
      if call.method == "prepare" {
        recordReadiness((error as? DeviceSpeakerFailure)?.rawValue ?? "preparation_failed", elapsedMs: 0, error: error)
      }
      result(FlutterError(code: (error as? DeviceSpeakerFailure)?.rawValue ?? "device_speaker_failed",
        message: "手机说话人识别暂不可用，转写和翻译可继续。", details: nil))
    }
  }

  /// Bounded, local, non-content diagnosis. Does not overwrite speaker QA
  /// results, include utterances/account IDs, or turn a failure into readiness.
  @MainActor
  private func recordReadiness(_ outcome: String, elapsedMs: Int, error: Error? = nil) {
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("wujie-speaker-readiness.json")
    var rows = (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: Any]] } ?? []
    var row: [String: Any] = ["at": ISO8601DateFormatter().string(from: Date()), "outcome": outcome,
      "elapsedMs": elapsedMs, "profile": DeviceSpeakerModelResources.profile, "revision": DeviceSpeakerModelResources.revision]
    if let error { row["nativeErrorCode"] = (error as NSError).code }
    rows.append(row)
    if let data = try? JSONSerialization.data(withJSONObject: Array(rows.suffix(32)), options: [.sortedKeys]) {
      try? data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    }
  }
}
