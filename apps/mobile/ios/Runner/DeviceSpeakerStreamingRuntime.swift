import Foundation

/// Direct translation of frozen 1.0 SortformerStreamingRuntime's sample window:
/// advance 6 * 1280 real samples, retain 1 left-context frame, wait for 7 right.
/// Never infer consumed samples from a center-padded mel feature count.
struct DeviceSpeakerPcmWindow {
  struct Window {
    let samples: [Float]
    let startFrame: Int, frames: Int, left: Int, right: Int
    var melFrames: Int { (frames + left + right) * 8 }
  }
  private var audio: [Float] = []
  private var origin = 0
  private(set) var nextFrame = 0
  private(set) var totalSamples = 0
  var retainedSamples: Int { audio.count }
  mutating func append(_ samples: [Float]) { audio.append(contentsOf:samples); totalSamples += samples.count }
  mutating func next(flush: Bool) -> Window? {
    let available = totalSamples / 1280, start = nextFrame
    guard start < available, flush || available >= start + 6 + 7 else { return nil }
    let end = min(start + 6, available), left = min(1,start), right = min(7,available-end)
    let a = (start-left)*1280-origin, b = (end+right)*1280-origin
    let result = Window(samples:Array(audio[a..<b]),startFrame:start,frames:end-start,left:left,right:right)
    nextFrame = end
    let keep = max(0,nextFrame-1)*1280, remove = keep-origin
    if remove > 0 { audio.removeFirst(remove); origin = keep }
    return result
  }
}

#if canImport(FluidAudio)
import CoreML
import FluidAudio

/// Reuse FluidAudio's model, mel extractor and streaming state updater. Only the
/// sample-window scheduling comes from 1.0; ASR, TTS, VAD and SDK are untouched.
final class DeviceSpeakerStreamingRuntime {
  private let config = SortformerConfig.fastV2_1
  private let models: SortformerModels
  private let mel = AudioMelSpectrogram()
  private let updater: SortformerStateUpdater
  private var state: SortformerStreamingState
  private var window = DeviceSpeakerPcmWindow()
  init(model: MLModel) throws {
    models = try SortformerModels(config:config,main:model)
    updater = SortformerStateUpdater(config:config)
    state = SortformerStreamingState(config:config)
  }
  func addAudio(_ samples: [Float]) { window.append(samples) }
  func process() throws -> DiarizerChunkResult? { try process(flush:false) }
  func finalizeSession() throws -> DiarizerChunkResult? { try process(flush:true) }
  func cleanup() { window = DeviceSpeakerPcmWindow(); state = SortformerStreamingState(config:config) }

  private func process(flush: Bool) throws -> DiarizerChunkResult? {
    let start = window.nextFrame
    var probabilities: [Float] = []
    while let part = window.next(flush:flush) {
      let (features,length,_) = mel.computeFlatTransposed(audio:part.samples)
      guard length >= part.melFrames, part.melFrames <= config.chunkMelFrames else { throw DeviceSpeakerFailure.invalidAudio }
      // NeMo uses the valid feature length, not the extra centered STFT frame.
      let output = try models.runMainModel(chunk:Array(features.prefix(part.melFrames*config.melFeatures)),
        chunkLength:part.melFrames,spkcache:state.spkcache,spkcacheLength:state.spkcacheLength,
        fifo:state.fifo,fifoLength:state.fifoLength,config:config)
      let embeddings = Array(output.chunkEmbeddings.prefix(output.chunkLength*config.preEncoderDims))
      let update = try updater.streamingUpdate(state:&state,chunk:embeddings,preds:output.predictions,
        leftContext:part.left,rightContext:part.right)
      guard update.confirmed.count == part.frames*4 else { throw DeviceSpeakerFailure.invalidAudio }
      probabilities.append(contentsOf:update.confirmed)
    }
    guard !probabilities.isEmpty else { return nil }
    return DiarizerChunkResult(startFrame:start,finalizedPredictions:probabilities,finalizedFrameCount:probabilities.count/4)
  }
}
#endif
