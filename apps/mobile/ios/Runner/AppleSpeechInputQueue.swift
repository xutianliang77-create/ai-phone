import Foundation
import CoreFoundation
import CryptoKit

enum SileroVadResources {
  static let modelName = "silero-vad-unified-256ms-v6.0.0.mlmodelc"
  static let hashes = [
    "analytics/coremldata.bin": "30945d54e32c3f15ec35dc6ee32128a27a6cdc03b0a12ffab04434069c49dfb5",
    "coremldata.bin": "0c3063bd09ba71c26ede0308d7c33591d0770e971a3fcc603ccad7ba1e8fb88d",
    "metadata.json": "e00405801b86542dbb722a2ec2fff285e539836990f4fdc6aa321ce1105eb32c",
    "model.mil": "4f93e2b5920e851fbc0be1c21a2a76e170124467ed7b01125190aa32e795f8af",
    "weights/weight.bin": "853cf34740d3f5061f977ebe2976f7c921b064261c9c4753b3a1196f2dba42b4",
  ]

  static func sileroURL() throws -> URL {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let candidates = [
      support.appendingPathComponent("Models/vad/\(modelName)"),
      Bundle.main.bundleURL.appendingPathComponent("Models/vad/\(modelName)"),
    ]
    guard let root = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else {
      throw AppleSpeechFailure.sileroMissing
    }
    for (path, expected) in hashes {
      let bytes = try Data(contentsOf: root.appendingPathComponent(path))
      let actual = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
      guard actual == expected else { throw AppleSpeechFailure.sileroCorrupt }
    }
    return root
  }
}

struct AppleSpeechPacket: Sendable {
  let samples: [Float]
  let offset: Int
}

enum AppleSpeechFailure: String, Error, LocalizedError {
  case busy, cancelled, unsupportedLanguage, automaticLanguageNotQualified
  case sileroMissing, sileroCorrupt, queueOverflow, stopTimeout
  case invalidConfiguration, languageResourceMissing
  var errorDescription: String? { rawValue }
}

struct AppleSpeechHypothesis {
  let key: Int, start: Int, end: Int
  let text: String
  let final: Bool
  var retracted = false
  func payload(sessionId: String, captureId: String, policy: String,
               language: String, revision: Int) -> [String: Any] {
    ["type": "segment", "id": "\(sessionId):\(key)", "text": text,
     "language": language, "languageEvidence": "user_selected", "isFinal": final,
     "isRetraction": retracted, "sessionId": sessionId, "captureId": captureId,
     "languagePolicyKey": policy, "revision": revision,
     "rangeStartSample": start, "rangeEndSample": end]
  }
}

/// A volatile phrase may move its audio start and need not be reissued as final.
/// Reuse identity over intersecting volatile ranges; use the SDK watermark to
/// commit unchanged earlier hypotheses. Text equality never merges real repeats.
struct AppleSpeechHypothesisTracker {
  private var nextKey = 0
  private var volatile: [Int: AppleSpeechHypothesis] = [:]

  mutating func accept(text: String, start: Int, end: Int,
                       final: Bool, finalizedThrough: Int) throws -> [AppleSpeechHypothesis] {
    guard start >= 0, end >= start else { throw AppleSpeechFailure.invalidConfiguration }
    let overlaps = volatile.values.filter {
      $0.start == start || (start < $0.end && end > $0.start)
    }.sorted {
      let a = min(end, $0.end) - max(start, $0.start)
      let b = min(end, $1.end) - max(start, $1.start)
      return a == b ? $0.key < $1.key : a > b
    }
    var updates: [AppleSpeechHypothesis] = []
    let chosen = overlaps.first?.key
    for previous in overlaps {
      volatile.removeValue(forKey: previous.key)
      if previous.key != chosen || text.isEmpty {
        updates.append(AppleSpeechHypothesis(key: previous.key, start: previous.start,
          end: previous.end, text: "", final: false, retracted: true))
      }
    }
    updates += finalize(through: finalizedThrough)
    if !text.isEmpty {
      let key: Int
      if let chosen { key = chosen }
      else { key = nextKey; nextKey += 1 }
      let value = AppleSpeechHypothesis(key: key, start: start, end: end,
        text: text, final: final || end <= finalizedThrough)
      if !value.final { volatile[key] = value }
      updates.append(value)
    }
    guard volatile.count <= 128 else { throw AppleSpeechFailure.queueOverflow }
    return updates.sorted { $0.start == $1.start ? $0.key < $1.key : $0.start < $1.start }
  }

  mutating func finalize(through sample: Int) -> [AppleSpeechHypothesis] {
    let committed = volatile.values.filter { $0.end <= sample }.sorted { $0.start < $1.start }
    for value in committed { volatile.removeValue(forKey: value.key) }
    return committed.map { AppleSpeechHypothesis(key: $0.key, start: $0.start,
      end: $0.end, text: $0.text, final: true) }
  }
}

/// Effective Apple/Silero parameters shared by preparation, capture and diagnostics.
struct AppleSpeechConfiguration {
  static let sampleRate = 16000
  static let vadFrameSamples = 4096
  let chunkDurationMs: Int
  let minSpeechMs: Int
  let silenceMs: Int
  let threshold: Double
  let negativeThreshold: Double
  let preRollMs: Int
  var preRollSamples: Int { preRollMs * 16 }
  var minSpeechSamples: Int { minSpeechMs * 16 }

  init(arguments: [String: Any] = [:]) throws {
    func number(_ key: String, _ fallback: Double, _ range: ClosedRange<Double>) throws -> Double {
      guard let value = arguments[key] else { return fallback }
      guard let value = value as? NSNumber,
            CFGetTypeID(value) != CFBooleanGetTypeID(),
            value.doubleValue.isFinite, range.contains(value.doubleValue) else {
        throw AppleSpeechFailure.invalidConfiguration
      }
      return value.doubleValue
    }
    func integer(_ key: String, _ fallback: Int, _ range: ClosedRange<Double>) throws -> Int {
      let value = try number(key, Double(fallback), range)
      guard value.rounded() == value else { throw AppleSpeechFailure.invalidConfiguration }
      return Int(value)
    }
    if let provider = arguments["vadProvider"] {
      guard provider as? String == "fluidaudio_silero" else { throw AppleSpeechFailure.invalidConfiguration }
    }
    chunkDurationMs = try integer("chunkDurationMs", 32, 1...1000)
    minSpeechMs = try integer("endpointMinSpeechMs", 96, 1...14000)
    silenceMs = try integer("endpointSilenceMs", 640, 1...14000)
    threshold = try number("vadThreshold", 0.6, 0.01...1)
    negativeThreshold = try number("vadNegativeThreshold", 0.35, 0...1)
    preRollMs = try integer("vadPreRollMs", 800, 0...8000)
    guard negativeThreshold < threshold else { throw AppleSpeechFailure.invalidConfiguration }
  }

  var parameters: [String: Any] {
    ["sampleRate": Self.sampleRate, "vadFrameSamples": Self.vadFrameSamples,
     "chunkDurationMs": chunkDurationMs, "endpointMinSpeechMs": minSpeechMs,
     "endpointSilenceMs": silenceMs, "vadProvider": "fluidaudio_silero",
     "vadThreshold": threshold, "vadNegativeThreshold": negativeThreshold,
     "vadPreRollMs": preRollMs, "endpointPolicy": "coreml_endpoint_detector",
     "audioPolicy": "continuous_pcm"]
  }

  var fingerprint: String {
    // All fields were validated before construction; no arbitrary payload values.
    let data = try! JSONSerialization.data(withJSONObject: parameters, options: [.sortedKeys])
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}

/// Recognition remains continuous. Only results with actual VAD speech overlap
/// may leave the session; an ASR final alone is not proof of spoken audio.
struct AppleSpeechActivityGate {
  enum Decision { case wait, accept, reject }
  private let preRollSamples: Int
  private let evidenceWaitSamples: Int
  private var intervals: [Range<Int>] = []
  private var activeStart: Int?
  private var processedThrough = 0
  private var finished = false

  init(preRollSamples: Int = 12800, evidenceWaitSamples: Int? = nil) {
    self.preRollSamples = max(0, preRollSamples)
    self.evidenceWaitSamples = max(preRollSamples, evidenceWaitSamples ?? preRollSamples)
  }

  mutating func advance(through sample: Int, speechEvent: (start: Bool, sample: Int)?) {
    processedThrough = max(processedThrough, sample)
    guard let event = speechEvent else { return }
    let position = max(0, min(event.sample, processedThrough))
    if event.start {
      if activeStart == nil { activeStart = max(0, position - preRollSamples) }
    } else if let start = activeStart {
      if position > start { intervals.append(start..<position) }
      activeStart = nil
    }
  }

  mutating func finish() { finished = true }

  func decision(start: Int, end: Int) -> Decision {
    guard start >= 0, end >= start else { return .reject }
    let overlaps = intervals.contains { start < $0.upperBound && end > $0.lowerBound }
    if overlaps { return .accept }
    if let activeStart, start < processedThrough, end > activeStart { return .accept }
    // A later VAD start may still establish evidence within its pre-roll.
    if !finished && end > max(0, processedThrough - evidenceWaitSamples) { return .wait }
    return .reject
  }
}

/// Audio callbacks enqueue directly. A single async consumer owns model state.
final class AppleSpeechInputQueue: @unchecked Sendable {
  let stream: AsyncThrowingStream<AppleSpeechPacket, Error>
  private let continuation: AsyncThrowingStream<AppleSpeechPacket, Error>.Continuation
  private let lock = NSLock()
  private var closed = false
  private var received = 0
  private var accepted = 0
  private var overflow = false

  init(capacity: Int = 128) {
    let pair = AsyncThrowingStream<AppleSpeechPacket, Error>.makeStream(
      bufferingPolicy: .bufferingOldest(capacity))
    stream = pair.stream
    continuation = pair.continuation
  }

  func append(_ samples: [Float]) {
    lock.lock()
    defer { lock.unlock() }
    guard !closed, !samples.isEmpty else { return }
    let packet = AppleSpeechPacket(samples: samples, offset: received)
    received += samples.count
    switch continuation.yield(packet) {
    case .enqueued: accepted += samples.count
    case .dropped:
      overflow = true; closed = true
      continuation.finish(throwing: AppleSpeechFailure.queueOverflow)
    case .terminated: closed = true
    @unknown default: closed = true
    }
  }

  func finish(tail: [Float] = []) {
    append(tail)
    lock.lock()
    defer { lock.unlock() }
    closed = true
    continuation.finish()
  }

  func snapshot() -> (received: Int, accepted: Int, overflow: Bool) {
    lock.lock()
    defer { lock.unlock() }
    return (received, accepted, overflow)
  }
}

private final class AppleSpeechDeadlineGate: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, Error>?
  private var completed: Result<Void, Error>?
  func install(_ value: CheckedContinuation<Void, Error>) {
    lock.lock()
    if let completed { lock.unlock(); value.resume(with: completed) }
    else { continuation = value; lock.unlock() }
  }
  func finish(_ result: Result<Void, Error>) {
    lock.lock()
    guard completed == nil else { lock.unlock(); return }
    completed = result
    let value = continuation; continuation = nil
    lock.unlock()
    value?.resume(with: result)
  }
}

/// Returns at the deadline even if the underlying framework ignores cancellation.
/// The caller closes its session's output and cancels the framework on timeout.
func appleSpeechWithDeadline(
  nanoseconds: UInt64 = 3_000_000_000,
  operation: @escaping @Sendable () async throws -> Void
) async throws {
  let gate = AppleSpeechDeadlineGate()
  let work = Task {
    do { try await operation(); gate.finish(.success(())) }
    catch { gate.finish(.failure(error)) }
  }
  let timer = Task {
    do { try await Task.sleep(nanoseconds: nanoseconds) }
    catch { return }
    gate.finish(.failure(AppleSpeechFailure.stopTimeout))
  }
  defer { work.cancel(); timer.cancel() }
  try await withCheckedThrowingContinuation { gate.install($0) }
}
