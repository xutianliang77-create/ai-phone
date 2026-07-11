import Foundation

struct CoreMlNemotronRuntimeOptions {
  let language: String
  let audioChunkDurationMs: Int
  let modelChunkMs: Int
  let autoDownloadModel: Bool
  let endpointMinSpeechMs: Int
  let endpointSilenceMs: Int
  let endpointSpeechThresholdRms: Double
}
