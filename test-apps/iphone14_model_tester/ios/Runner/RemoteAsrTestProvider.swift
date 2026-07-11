import Foundation

final class RemoteAsrTestProvider {
  private let providerId = "remote_asr"
  private let audioInput = CoreMlNemotronAudioInput()
  private let queue = DispatchQueue(label: "translation_mobile.remote_asr.network")

  private var modelId = "Qwen3-ASR-0.6B-original-tuned-v3"
  private var sessionId = "remote-asr"
  private var endpoint = URL(string: "http://100.110.127.117:8021/asr/transcribe")!
  private var flushEndpointTemplate = "http://100.110.127.117:8021/asr/sessions/:sessionId/flush"
  private var apiKey = ""
  private var sourceLanguage = "zh"
  private var targetLanguage = "en"
  private var uploadMode = "whole_clip"
  private var sequence = 1
  private var running = false
  private var framesSent = 0
  private var transcriptsEmitted = 0
  private var wholeClipSamples: [Float] = []
  private var wholeClipFrameSamples = 5120
  private var lastError: String?

  func status() -> [String: Any] {
    let state = queue.sync {
      [
        "providerId": providerId,
        "modelId": modelId,
        "ready": true,
        "running": running,
        "sessionId": sessionId,
        "endpoint": endpoint.absoluteString,
        "sourceLanguage": sourceLanguage,
        "targetLanguage": targetLanguage,
        "uploadMode": uploadMode,
        "sequence": sequence,
        "framesSent": framesSent,
        "transcriptsEmitted": transcriptsEmitted,
        "wholeClipSamples": wholeClipSamples.count,
        "lastError": lastError ?? ""
      ] as [String: Any]
    }
    var payload = state
    payload["audio"] = audioInput.payload()
    return payload
  }

  func start(
    arguments: Any?,
    emit: @escaping ([String: Any]) -> Void
  ) -> [String: Any] {
    _ = audioInput.stop(flushPending: false)
    let args = arguments as? [String: Any]
    guard let endpoint = URL(string: stringArgument("remoteAsrEndpoint", from: args)
      ?? "http://100.110.127.117:8021/asr/transcribe") else {
      return ["started": false, "providerId": providerId, "reason": "invalid_remote_asr_endpoint"]
    }

    let chunkDurationMs = intArgument("chunkDurationMs", from: args) ?? 320
    queue.sync {
      self.modelId = stringArgument("modelId", from: args) ?? self.modelId
      self.sessionId = stringArgument("sessionId", from: args) ?? "remote-asr-\(Self.nowMs())"
      self.endpoint = endpoint
      self.flushEndpointTemplate = stringArgument("remoteAsrFlushEndpoint", from: args)
        ?? "http://100.110.127.117:8021/asr/sessions/:sessionId/flush"
      self.apiKey = stringArgument("remoteAsrApiKey", from: args) ?? ""
      self.sourceLanguage = normalizedLanguage(
        stringArgument("sourceLanguage", from: args)
          ?? stringArgument("language", from: args)
          ?? stringArgument("localeId", from: args)
          ?? "auto"
      )
      self.targetLanguage = normalizedTargetLanguage(
        stringArgument("targetLanguage", from: args),
        sourceLanguage: self.sourceLanguage
      )
      self.uploadMode = normalizedUploadMode(
        stringArgument("remoteAsrUploadMode", from: args) ?? "whole_clip"
      )
      self.sequence = 1
      self.framesSent = 0
      self.transcriptsEmitted = 0
      self.wholeClipSamples = []
      self.wholeClipFrameSamples = max(1, 16_000 * chunkDurationMs / 1000)
      self.lastError = nil
      self.running = true
    }

    do {
      try audioInput.start(chunkDurationMs: chunkDurationMs) { [weak self] samples in
        self?.enqueueFrame(samples: samples, emit: emit)
      }
      emit([
        "type": "started",
        "providerId": providerId,
        "modelId": modelId,
        "endpoint": endpoint.absoluteString,
        "uploadMode": uploadMode,
        "timestampMs": Self.nowMs()
      ])
      return [
        "started": true,
        "providerId": providerId,
        "modelId": modelId,
        "endpoint": endpoint.absoluteString,
        "uploadMode": uploadMode
      ]
    } catch {
      queue.sync {
        self.running = false
        self.lastError = error.localizedDescription
      }
      emit([
        "type": "error",
        "providerId": providerId,
        "modelId": modelId,
        "message": error.localizedDescription,
        "timestampMs": Self.nowMs()
      ])
      return [
        "started": false,
        "providerId": providerId,
        "modelId": modelId,
        "reason": "audio_start_failed",
        "message": error.localizedDescription
      ]
    }
  }

  func stop(emit: @escaping ([String: Any]) -> Void) async -> [String: Any] {
    let tail = audioInput.stop(flushPending: true)
    return await withCheckedContinuation { continuation in
      queue.async { [weak self] in
        guard let self else {
          continuation.resume(returning: ["stopped": false, "reason": "provider_released"])
          return
        }
        var captureDebug: [String: Any] = [:]
        if self.uploadMode == "whole_clip" {
          if !tail.isEmpty {
            self.wholeClipSamples.append(contentsOf: tail)
          }
          captureDebug = self.sendWholeClipLocked(emit: emit)
        } else if !tail.isEmpty {
          self.sendFrameLocked(Self.pcm16Data(from: tail), emit: emit)
        }
        let flushResponse = self.postJsonLocked(
          url: self.flushUrlLocked(),
          payload: [
            "sourceLanguage": self.sourceLanguage,
            "targetLanguage": self.targetLanguage
          ]
        )
        self.emitResponseLocked(flushResponse, eventType: "remote.flush", emit: emit)
        self.running = false
        emit([
          "type": "stopped",
          "providerId": self.providerId,
          "modelId": self.modelId,
          "framesSent": self.framesSent,
          "transcriptsEmitted": self.transcriptsEmitted,
          "uploadMode": self.uploadMode,
          "wholeClipSamples": self.wholeClipSamples.count,
          "wholeClipDurationMs": self.wholeClipDurationMsLocked(),
          "debugCapture": captureDebug,
          "audio": self.audioInput.payload(),
          "timestampMs": Self.nowMs()
        ])
        continuation.resume(returning: [
          "stopped": true,
          "providerId": self.providerId,
          "modelId": self.modelId,
          "framesSent": self.framesSent,
          "transcriptsEmitted": self.transcriptsEmitted,
          "uploadMode": self.uploadMode,
          "wholeClipSamples": self.wholeClipSamples.count,
          "wholeClipDurationMs": self.wholeClipDurationMsLocked(),
          "debugCapture": captureDebug
        ])
      }
    }
  }

  private func enqueueFrame(samples: [Float], emit: @escaping ([String: Any]) -> Void) {
    queue.async { [weak self] in
      guard let self else { return }
      if self.uploadMode == "whole_clip" {
        self.wholeClipSamples.append(contentsOf: samples)
      } else {
        self.sendFrameLocked(Self.pcm16Data(from: samples), emit: emit)
      }
    }
  }

  private func sendWholeClipLocked(emit: @escaping ([String: Any]) -> Void) -> [String: Any] {
    guard !wholeClipSamples.isEmpty else { return [:] }
    let pcm = Self.pcm16Data(from: wholeClipSamples)
    let captureDebug = writeCaptureDebugLocked(pcm: pcm)
    let frameSamples = max(1, wholeClipFrameSamples)
    let frameCount = Int(ceil(Double(wholeClipSamples.count) / Double(frameSamples)))
    emit([
      "type": "remote.capture",
      "providerId": providerId,
      "modelId": modelId,
      "uploadMode": uploadMode,
      "wholeClipSamples": wholeClipSamples.count,
      "wholeClipDurationMs": wholeClipDurationMsLocked(),
      "wholeClipFrameSamples": frameSamples,
      "wholeClipFrameCount": frameCount,
      "debugCapture": captureDebug,
      "timestampMs": Self.nowMs()
    ])

    var start = 0
    while start < wholeClipSamples.count {
      let end = min(start + frameSamples, wholeClipSamples.count)
      let frame = Array(wholeClipSamples[start..<end])
      sendFrameLocked(
        Self.pcm16Data(from: frame),
        eventType: "remote.whole_clip.frame",
        emit: emit
      )
      start = end
    }
    return captureDebug
  }

  private func sendFrameLocked(
    _ data: Data,
    eventType: String = "remote.frame",
    emit: @escaping ([String: Any]) -> Void
  ) {
    guard !data.isEmpty else { return }
    let frameSequence = sequence
    sequence += 1
    framesSent += 1
    let response = postJsonLocked(
      url: endpoint,
      payload: [
        "sessionId": sessionId,
        "sequence": frameSequence,
        "timestampMs": Self.nowMs(),
        "format": "pcm16",
        "sampleRate": 16000,
        "data": data.base64EncodedString(),
        "sourceLanguage": sourceLanguage,
        "targetLanguage": targetLanguage
      ]
    )
    emitResponseLocked(response, eventType: eventType, emit: emit)
  }

  private func emitResponseLocked(
    _ response: RemoteAsrHttpResponse,
    eventType: String,
    emit: @escaping ([String: Any]) -> Void
  ) {
    if let error = response.error {
      lastError = error
      emit([
        "type": "error",
        "providerId": providerId,
        "modelId": modelId,
        "eventType": eventType,
        "statusCode": response.statusCode,
        "message": error,
        "timestampMs": Self.nowMs()
      ])
      return
    }
    guard let body = response.body, response.statusCode != 204 else { return }
    let text = (body["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    transcriptsEmitted += 1
    emit([
      "type": "speech",
      "segmentId": body["segmentId"] as? String ?? "\(eventType)-\(transcriptsEmitted)",
      "text": text,
      "isFinal": true,
      "language": body["language"] as? String ?? sourceLanguage,
      "confidence": body["confidence"] as? Double ?? NSNull(),
      "providerId": providerId,
      "modelId": modelId,
      "timestampMs": Self.nowMs()
    ])
  }

  private func postJsonLocked(url: URL, payload: [String: Any]) -> RemoteAsrHttpResponse {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if !apiKey.isEmpty {
      request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    }
    do {
      request.httpBody = try JSONSerialization.data(withJSONObject: payload)
    } catch {
      return RemoteAsrHttpResponse(statusCode: 0, body: nil, error: error.localizedDescription)
    }

    let semaphore = DispatchSemaphore(value: 0)
    var result = RemoteAsrHttpResponse(statusCode: 0, body: nil, error: "request_not_completed")
    URLSession.shared.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
      if let error {
        result = RemoteAsrHttpResponse(statusCode: statusCode, body: nil, error: error.localizedDescription)
        return
      }
      if statusCode == 204 {
        result = RemoteAsrHttpResponse(statusCode: statusCode, body: nil, error: nil)
        return
      }
      let body = Self.jsonObject(from: data)
      if (200..<300).contains(statusCode) {
        result = RemoteAsrHttpResponse(statusCode: statusCode, body: body, error: nil)
      } else {
        let message = body?["detail"] as? String
          ?? String(data: data ?? Data(), encoding: .utf8)
          ?? "HTTP \(statusCode)"
        result = RemoteAsrHttpResponse(statusCode: statusCode, body: body, error: message)
      }
    }.resume()
    if semaphore.wait(timeout: .now() + 35) == .timedOut {
      return RemoteAsrHttpResponse(statusCode: 0, body: nil, error: "request_timeout")
    }
    return result
  }

  private func flushUrlLocked() -> URL {
    let encodedSessionId = sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
      ?? sessionId
    let value = flushEndpointTemplate.replacingOccurrences(of: ":sessionId", with: encodedSessionId)
    return URL(string: value) ?? endpoint
  }

  private func stringArgument(_ name: String, from args: [String: Any]?) -> String? {
    let value = args?[name] as? String
    return value?.isEmpty == false ? value : nil
  }

  private func intArgument(_ name: String, from args: [String: Any]?) -> Int? {
    if let value = args?[name] as? Int { return value }
    return (args?[name] as? NSNumber)?.intValue
  }

  private func normalizedLanguage(_ value: String) -> String {
    let lower = value.lowercased()
    if lower.hasPrefix("zh") { return "zh" }
    if lower.hasPrefix("en") { return "en" }
    return "auto"
  }

  private func normalizedTargetLanguage(_ value: String?, sourceLanguage: String) -> String {
    if let value {
      let normalized = normalizedLanguage(value)
      if normalized != "auto" { return normalized }
    }
    if sourceLanguage == "zh" { return "en" }
    if sourceLanguage == "en" { return "zh" }
    return "auto"
  }

  private func normalizedUploadMode(_ value: String) -> String {
    value == "streaming" ? "streaming" : "whole_clip"
  }

  private func wholeClipDurationMsLocked() -> Int {
    wholeClipSamples.count * 1000 / 16_000
  }

  private func writeCaptureDebugLocked(pcm: Data) -> [String: Any] {
    let rms = Self.pcm16Rms(pcm)
    let peak = Self.pcm16Peak(pcm)
    do {
      let documentsUrl = try FileManager.default.url(
        for: .documentDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let latestUrl = documentsUrl.appendingPathComponent("last-remote-asr-capture.wav")
      let runUrl = documentsUrl.appendingPathComponent("\(Self.safeFileName(sessionId))-capture.wav")
      let wav = Self.wavData(pcm: pcm, sampleRate: 16_000)
      try wav.write(to: latestUrl, options: .atomic)
      try wav.write(to: runUrl, options: .atomic)
      return [
        "wavPath": latestUrl.path,
        "runWavPath": runUrl.path,
        "bytes": wav.count,
        "pcm16Rms": rms,
        "pcm16Peak": peak
      ]
    } catch {
      return [
        "error": error.localizedDescription,
        "pcm16Rms": rms,
        "pcm16Peak": peak
      ]
    }
  }

  private static func pcm16Data(from samples: [Float]) -> Data {
    var data = Data(capacity: samples.count * 2)
    for sample in samples {
      let clamped = min(1.0, max(-1.0, sample))
      var value = Int16(clamped * Float(Int16.max)).littleEndian
      withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
    }
    return data
  }

  private static func pcm16Rms(_ data: Data) -> Int {
    var total = 0.0
    var count = 0
    let bytes = [UInt8](data)
    var offset = 0
    while offset + 1 < bytes.count {
      let raw = UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
      let value = Double(Int16(bitPattern: raw))
      total += value * value
      count += 1
      offset += 2
    }
    guard count > 0 else { return 0 }
    return Int(sqrt(total / Double(count)))
  }

  private static func pcm16Peak(_ data: Data) -> Int {
    var peak = 0
    let bytes = [UInt8](data)
    var offset = 0
    while offset + 1 < bytes.count {
      let raw = UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
      let value = Int(Int16(bitPattern: raw))
      peak = max(peak, abs(value))
      offset += 2
    }
    return peak
  }

  private static func wavData(pcm: Data, sampleRate: Int) -> Data {
    var data = Data()
    appendAscii("RIFF", to: &data)
    appendUInt32(UInt32(36 + pcm.count), to: &data)
    appendAscii("WAVE", to: &data)
    appendAscii("fmt ", to: &data)
    appendUInt32(16, to: &data)
    appendUInt16(1, to: &data)
    appendUInt16(1, to: &data)
    appendUInt32(UInt32(sampleRate), to: &data)
    appendUInt32(UInt32(sampleRate * 2), to: &data)
    appendUInt16(2, to: &data)
    appendUInt16(16, to: &data)
    appendAscii("data", to: &data)
    appendUInt32(UInt32(pcm.count), to: &data)
    data.append(pcm)
    return data
  }

  private static func appendAscii(_ value: String, to data: inout Data) {
    data.append(value.data(using: .ascii) ?? Data())
  }

  private static func appendUInt16(_ value: UInt16, to data: inout Data) {
    var littleEndian = value.littleEndian
    withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
  }

  private static func appendUInt32(_ value: UInt32, to data: inout Data) {
    var littleEndian = value.littleEndian
    withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
  }

  private static func safeFileName(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    return String(value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" })
  }

  private static func jsonObject(from data: Data?) -> [String: Any]? {
    guard let data, !data.isEmpty else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private static func nowMs() -> Int {
    Int(Date().timeIntervalSince1970 * 1000)
  }
}

private struct RemoteAsrHttpResponse {
  let statusCode: Int
  let body: [String: Any]?
  let error: String?
}
