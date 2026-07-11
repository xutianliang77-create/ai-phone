import Foundation

#if canImport(FluidAudio)
import FluidAudio
#endif

final class CoreMlNemotronModelResolver {
  private let modelStore: CoreMlNemotronModelStore
  private var lastResolvedPath: String?
  private var lastResolution = "not_started"

  init(modelStore: CoreMlNemotronModelStore) {
    self.modelStore = modelStore
  }

  func payload() -> [String: Any] {
    [
      "lastResolvedPath": lastResolvedPath as Any,
      "lastResolution": lastResolution
    ]
  }

  #if canImport(FluidAudio)
  func resolve(
    language: String,
    modelChunkMs: Int,
    autoDownload: Bool
  ) async throws -> URL {
    if let bundle = modelStore.findBundle(), bundle.isFluidAudioReady {
      lastResolvedPath = bundle.rootURL.path
      lastResolution = "local"
      return bundle.rootURL
    }
    guard autoDownload else {
      throw resolverError(
        code: modelStore.findBundle() == nil ? "model_not_found" : "model_incomplete",
        message: "Nemotron FluidAudio model bundle was not found or is incomplete"
      )
    }
    let url = try await StreamingNemotronMultilingualAsrManager.downloadVariant(
      languageCode: language,
      chunkMs: modelChunkMs
    )
    lastResolvedPath = url.path
    lastResolution = "downloaded_or_cached"
    return url
  }
  #else
  func resolve(
    language: String,
    modelChunkMs: Int,
    autoDownload: Bool
  ) async throws -> URL {
    throw resolverError(
      code: "fluidaudio_unavailable",
      message: "FluidAudio Swift package is not linked into the iOS target"
    )
  }
  #endif

  private func resolverError(code: String, message: String) -> NSError {
    NSError(
      domain: "CoreMlNemotronModelResolver",
      code: 1,
      userInfo: [
        NSLocalizedDescriptionKey: message,
        "code": code
      ]
    )
  }
}
