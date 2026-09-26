import CoreML
import CryptoKit
import Foundation

enum DeviceSpeakerModelResources {
  static let profile = "sortformer_v2_1_fastest"
  static let revision = "ae9a27ab45dc0aa3abede7d2d6bad2b7a69aa6d1"
  static let modelName = "Sortformer_v2.1.mlmodelc"
  private static let files: [(String, Int, String)] = [
    ("analytics/coremldata.bin", 202, "e1a18b8f51199d7598c0728aeb6ef5ca344aa2e52880033fac32a795e5b76539"),
    ("coremldata.bin", 1093, "bdd45ff82f293430575243db4cb5c6c6222802fbec8fa7a704b2f508b1712748"),
    ("metadata.json", 5173, "afca9d27f227fd41a0f78233da89077220924012cda8d4e299cc5dcfd2d12236"),
    ("model0/analytics/coremldata.bin", 108, "5a8281049b2a65a3be541cfd9f949e84b8fe1c5251ce90e46da1626fed54e58a"),
    ("model0/coremldata.bin", 640, "8eacfed010ece708c53af08a5d3aa42d3ccd81d7b2fe810035c6ecf2f916775c"),
    ("model0/model.mil", 31807, "ddc2f961b4307db46ddd412616a3f24e8e5dc078ad143e940b993a5c39e70340"),
    ("model0/weights/0-weight.bin", 8948544, "88a98803e35186b1dfb41d7f748f7cee5093bb6efeb117f56953c17549792fa4"),
    ("model1/analytics/coremldata.bin", 108, "5a8281049b2a65a3be541cfd9f949e84b8fe1c5251ce90e46da1626fed54e58a"),
    ("model1/coremldata.bin", 605, "527d55717a4b7239861d905cf666216ab378e31050cb9e6714f2774d00f9f22c"),
    ("model1/model.mil", 1147856, "c064cd7dd36372fa5cbe0bc4f2550e542c8fcd1fd0281a7b2b840959fbc1687d"),
    ("model1/weights/1-weight.bin", 230428224, "4c85926af77684bce762b355a2b162df557d832444fbeb79ee195113a4bbf1db"),
  ]

  static func modelURL() throws -> URL {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let candidates = [
      Bundle.main.resourceURL?.appendingPathComponent("Models/Speaker").appendingPathComponent(modelName),
      documents.appendingPathComponent("wujie-speaker").appendingPathComponent(modelName)
    ].compactMap { $0 }
    guard let root = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else {
      throw DeviceSpeakerFailure.resourcesMissing
    }
    let safeRoot = root.resolvingSymlinksInPath().path + "/"
    for (name, count, expected) in files {
      let file = root.appendingPathComponent(name)
      guard file.resolvingSymlinksInPath().path.hasPrefix(safeRoot),
        let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size]) as? NSNumber,
        size.intValue == count, try sha256(file) == expected else {
        throw DeviceSpeakerFailure.resourcesInvalid
      }
    }
    return root
  }

  static func load() throws -> MLModel {
    let url: URL
    do { url = try modelURL() }
    catch let failure as DeviceSpeakerFailure { throw failure }
    catch { throw DeviceSpeakerFailure.resourcesInvalid }
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .cpuAndNeuralEngine
    // Compiled, verified local model only. No SDK download or remote fallback.
    return try MLModel(contentsOf: url, configuration: configuration)
  }

  private static func sha256(_ url: URL) throws -> String {
    guard let stream = InputStream(url: url) else { throw DeviceSpeakerFailure.resourcesInvalid }
    stream.open(); defer { stream.close() }
    var hash = SHA256(), buffer = [UInt8](repeating: 0, count: 1024 * 1024)
    while true {
      let count = stream.read(&buffer, maxLength: buffer.count)
      if count < 0 { throw DeviceSpeakerFailure.resourcesInvalid }
      if count == 0 { break }
      hash.update(data: Data(buffer.prefix(count)))
    }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
  }
}

enum DeviceSpeakerFailure: String, Error {
  case resourcesMissing = "device_speaker_model_missing"
  case resourcesInvalid = "device_speaker_model_invalid"
  case unsupported = "device_speaker_not_supported"
  case invalidAudio = "device_speaker_audio_invalid"
  case cancelled = "device_speaker_cancelled"
  case busy = "device_speaker_busy"
  case backpressure = "device_speaker_backpressure"
}

/// Account-independent, immutable model resources. Concurrent readiness calls
/// share one load; a failed load is retryable and never cached as ready.
final class DeviceSpeakerPreparationCache<Value> {
  @MainActor private var value: Value?
  @MainActor private var loading: Task<Value, Error>?
  @MainActor private var generation = UUID()

  @MainActor
  func prepare(load: @escaping @Sendable () throws -> Value) async throws -> Value {
    if let value { return value }
    if loading == nil {
      generation = UUID()
      loading = Task.detached(priority: .userInitiated) { try load() }
    }
    let current = generation
    do {
      let loaded = try await loading!.value
      value = loaded
      if generation == current { loading = nil }
      return loaded
    } catch {
      if generation == current { loading = nil }
      throw error
    }
  }
}
