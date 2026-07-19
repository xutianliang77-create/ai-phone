import Foundation

struct CoreMlNemotronRuntimeOptions {
  let language: String
  let audioChunkDurationMs: Int
  let modelChunkMs: Int
  let autoDownloadModel: Bool
  let endpointMinSpeechMs: Int
  let endpointSilenceMs: Int
  let endpointSpeechThresholdRms: Double
  let vadProvider: String
  let vadThreshold: Double
  let vadNegativeThreshold: Double
  let vadPreRollMs: Int
  let turnRoutingPolicy: String
  let diagnosticCaptureEnabled: Bool
  let diagnosticSessionId: String?
}
