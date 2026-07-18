import CryptoKit
import Foundation

final class CoreMlNemotronDiagnosticRecorder {
  private let lock = NSLock()
  private let sampleRate = 16_000
  private let maxAudioSamples = 16_000 * 60 * 20
  private let maxTimelineEvents = 20_000

  private var enabled = false
  private var sessionId = "diagnostic"
  private var startedAt: Date?
  private var configuration: [String: Any] = [:]
  private var timeline: [[String: Any]] = []
  private var pcm16 = Data()
  private var audioTruncated = false
  private var timelineTruncated = false
  private var lastJsonPath: String?
  private var lastAudioPath: String?
  private var lastError: String?
  private var lastEventCount = 0
  private var lastAudioSamples = 0

  func start(
    enabled: Bool,
    sessionId: String?,
    configuration: [String: Any],
    modelDirectory: String?
  ) {
    lock.lock()
    defer { lock.unlock() }
    self.enabled = enabled
    self.sessionId = sanitizedIdentifier(sessionId ?? "diagnostic")
    startedAt = enabled ? Date() : nil
    timeline.removeAll(keepingCapacity: true)
    pcm16.removeAll(keepingCapacity: true)
    audioTruncated = false
    timelineTruncated = false
    lastError = nil
    self.configuration = configuration
    if let modelDirectory {
      self.configuration["modelDirectory"] = modelDirectory
      self.configuration["modelFingerprint"] =
        modelFingerprint(directory: modelDirectory) as Any
    }
    if enabled {
      appendEventLocked(type: "session.start", payload: [:])
    }
  }

  func appendAudio(_ samples: [Float]) {
    lock.lock()
    defer { lock.unlock() }
    guard enabled, !samples.isEmpty else { return }
    let existingSamples = pcm16.count / MemoryLayout<Int16>.size
    let remaining = max(0, maxAudioSamples - existingSamples)
    guard remaining > 0 else {
      audioTruncated = true
      return
    }
    let accepted = samples.prefix(remaining)
    for sample in accepted {
      let scaled = Int(
        (Double(sample).clamped(to: -1...1) * Double(Int16.max)).rounded()
      )
      var value = Int16(clamping: scaled).littleEndian
      withUnsafeBytes(of: &value) { pcm16.append(contentsOf: $0) }
    }
    if accepted.count < samples.count {
      audioTruncated = true
    }
  }

  func record(type: String, payload: [String: Any] = [:]) {
    lock.lock()
    defer { lock.unlock() }
    guard enabled else { return }
    appendEventLocked(type: type, payload: payload)
  }

  func finish() {
    lock.lock()
    guard enabled, let startedAt else {
      lock.unlock()
      return
    }
    appendEventLocked(type: "session.stop", payload: [:])
    let localTimeline = timeline
    let localPcm16 = pcm16
    let localConfiguration = configuration
    let localSessionId = sessionId
    let localAudioTruncated = audioTruncated
    let localTimelineTruncated = timelineTruncated
    enabled = false
    self.startedAt = nil
    lock.unlock()

    do {
      let directory = try diagnosticDirectory()
      let stamp = Int(startedAt.timeIntervalSince1970 * 1000)
      let baseName = "coreml-nemotron-\(localSessionId)-\(stamp)"
      let audioURL = directory.appendingPathComponent("\(baseName).wav")
      let jsonURL = directory.appendingPathComponent("\(baseName).json")
      try wavData(pcm16: localPcm16).write(to: audioURL, options: .atomic)
      let document: [String: Any] = [
        "schemaVersion": 1,
        "sessionId": localSessionId,
        "startedAt": iso8601(startedAt),
        "endedAt": iso8601(Date()),
        "configuration": sanitizedJsonValue(localConfiguration),
        "audio": [
          "path": audioURL.path,
          "sampleRate": sampleRate,
          "samples": localPcm16.count / MemoryLayout<Int16>.size,
          "truncated": localAudioTruncated
        ],
        "timelineTruncated": localTimelineTruncated,
        "timeline": sanitizedJsonValue(localTimeline)
      ]
      let json = try JSONSerialization.data(
        withJSONObject: document,
        options: [.prettyPrinted, .sortedKeys]
      )
      try json.write(to: jsonURL, options: .atomic)
      lock.lock()
      lastAudioPath = audioURL.path
      lastJsonPath = jsonURL.path
      lastEventCount = localTimeline.count
      lastAudioSamples = localPcm16.count / MemoryLayout<Int16>.size
      lastError = nil
      lock.unlock()
    } catch {
      lock.lock()
      lastError = error.localizedDescription
      lock.unlock()
    }
  }

  func payload() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "captureEnabled": enabled,
      "currentEventCount": timeline.count,
      "currentAudioSamples": pcm16.count / MemoryLayout<Int16>.size,
      "audioTruncated": audioTruncated,
      "timelineTruncated": timelineTruncated,
      "lastJsonPath": lastJsonPath as Any,
      "lastAudioPath": lastAudioPath as Any,
      "lastEventCount": lastEventCount,
      "lastAudioSamples": lastAudioSamples,
      "lastError": lastError as Any
    ]
  }

  private func appendEventLocked(type: String, payload: [String: Any]) {
    guard timeline.count < maxTimelineEvents else {
      timelineTruncated = true
      return
    }
    let elapsedMs = startedAt.map {
      Int(Date().timeIntervalSince($0) * 1000)
    } ?? 0
    timeline.append([
      "elapsedMs": max(0, elapsedMs),
      "recordedAt": iso8601(Date()),
      "type": type,
      "payload": sanitizedJsonValue(payload)
    ])
  }

  private func diagnosticDirectory() throws -> URL {
    guard let documents = FileManager.default.urls(
      for: .documentDirectory,
      in: .userDomainMask
    ).first else {
      throw NSError(
        domain: "CoreMlNemotronDiagnosticRecorder",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Documents directory unavailable"]
      )
    }
    let directory = documents
      .appendingPathComponent("Diagnostics", isDirectory: true)
      .appendingPathComponent("DeviceASR", isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    return directory
  }

  private func wavData(pcm16: Data) -> Data {
    var data = Data()
    data.append("RIFF".data(using: .ascii)!)
    append(UInt32(36 + pcm16.count), to: &data)
    data.append("WAVE".data(using: .ascii)!)
    data.append("fmt ".data(using: .ascii)!)
    append(UInt32(16), to: &data)
    append(UInt16(1), to: &data)
    append(UInt16(1), to: &data)
    append(UInt32(sampleRate), to: &data)
    append(UInt32(sampleRate * 2), to: &data)
    append(UInt16(2), to: &data)
    append(UInt16(16), to: &data)
    data.append("data".data(using: .ascii)!)
    append(UInt32(pcm16.count), to: &data)
    data.append(pcm16)
    return data
  }

  private func append<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
    var littleEndian = value.littleEndian
    withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
  }

  private func modelFingerprint(directory: String) -> String? {
    let metadataURL = URL(fileURLWithPath: directory)
      .appendingPathComponent("metadata.json")
    guard let data = try? Data(contentsOf: metadataURL) else { return nil }
    return SHA256.hash(data: data).map {
      String(format: "%02x", $0)
    }.joined()
  }

  private func sanitizedIdentifier(_ raw: String) -> String {
    let cleaned = raw.replacingOccurrences(
      of: "[^A-Za-z0-9_-]",
      with: "_",
      options: .regularExpression
    )
    return String(cleaned.prefix(80))
  }

  private func sanitizedJsonValue(_ value: Any) -> Any {
    if value is NSNull
      || value is String
      || value is NSNumber
      || value is Bool {
      return value
    }
    if let map = value as? [String: Any] {
      return map.mapValues(sanitizedJsonValue)
    }
    if let array = value as? [Any] {
      return array.map(sanitizedJsonValue)
    }
    let mirror = Mirror(reflecting: value)
    if mirror.displayStyle == .optional {
      guard let child = mirror.children.first else { return NSNull() }
      return sanitizedJsonValue(child.value)
    }
    return String(describing: value)
  }

  private func iso8601(_ date: Date) -> String {
    ISO8601DateFormatter().string(from: date)
  }
}

private extension Double {
  func clamped(to range: ClosedRange<Double>) -> Double {
    min(max(self, range.lowerBound), range.upperBound)
  }
}
