import Foundation

/// Explicit, versioned candidates. The ordinary App still selects Fastest;
/// Balanced is available only to the existing file QA until device acceptance.
enum DeviceSpeakerModelVariant: String, CaseIterable, Sendable {
  case fastest = "sortformer_v2_1_fastest"
  case balanced = "sortformer_v2_1_balanced"
  var modelName: String { self == .fastest ? "Sortformer_v2.1.mlmodelc" : "SortformerNvidiaLow_v2.1.mlmodelc" }
  var chunkFrames: Int { 6 }
  var leftFrames: Int { 1 }
  var rightFrames: Int { 7 }
  var fifoFrames: Int { self == .fastest ? 40 : 188 }
  var cacheFrames: Int { 188 }
  var cacheUpdateFrames: Int { self == .fastest ? 31 : 144 }
  func selectedCacheUpdateFrames(_ proposed:Int?) throws -> Int {
    guard let proposed else { return cacheUpdateFrames }
    guard proposed==cacheUpdateFrames || self == .fastest && [24,31,40].contains(proposed) else { throw TuningFailure.unsupportedCacheUpdate }
    return proposed
  }
  enum TuningFailure:Error { case unsupportedCacheUpdate }
  var inputShapes: [String:[Int]] { ["chunk":[1,(chunkFrames+leftFrames+rightFrames)*8,128],
    "spkcache":[1,cacheFrames,512],"fifo":[1,fifoFrames,512]] }
}

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
  private let profile: DeviceSpeakerModelVariant
  private(set) var nextFrame = 0
  private(set) var totalSamples = 0
  var retainedSamples: Int { audio.count }
  init(profile: DeviceSpeakerModelVariant = .fastest) { self.profile = profile }
  mutating func append(_ samples: [Float]) { audio.append(contentsOf:samples); totalSamples += samples.count }
  mutating func next(flush: Bool) -> Window? {
    let available = totalSamples / 1280, start = nextFrame
    guard start < available, flush || available >= start + profile.chunkFrames + profile.rightFrames else { return nil }
    let end = min(start + profile.chunkFrames, available), left = min(profile.leftFrames,start), right = min(profile.rightFrames,available-end)
    let a = (start-left)*1280-origin, b = (end+right)*1280-origin
    let result = Window(samples:Array(audio[a..<b]),startFrame:start,frames:end-start,left:left,right:right)
    nextFrame = end
    let keep = max(0,nextFrame-profile.leftFrames)*1280, remove = keep-origin
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
  private let config: SortformerConfig
  private let profile: DeviceSpeakerModelVariant
  private let models: SortformerModels
  private let mel = AudioMelSpectrogram()
  private let updater: SortformerStateUpdater
  private var state: SortformerStreamingState
  private var window: DeviceSpeakerPcmWindow
  init(model: MLModel, profile: DeviceSpeakerModelVariant = .fastest, cacheUpdateFrames:Int? = nil) throws {
    self.profile = profile
    var selected:SortformerConfig = profile == .fastest ? .fastV2_1 : .balancedV2_1
    selected.spkcacheUpdatePeriod=try profile.selectedCacheUpdateFrames(cacheUpdateFrames)
    config=selected
    window = DeviceSpeakerPcmWindow(profile:profile)
    for (name,shape) in profile.inputShapes {
      guard model.modelDescription.inputDescriptionsByName[name]?.multiArrayConstraint?.shape.map(\.intValue) == shape else {
        throw DeviceSpeakerFailure.resourcesInvalid
      }
    }
    models = try SortformerModels(config:config,main:model)
    updater = SortformerStateUpdater(config:config)
    state = SortformerStreamingState(config:config)
  }
  func addAudio(_ samples: [Float]) { window.append(samples) }
  var inferenceSettings: [String:Any] {
    ["sampleRate":config.sampleRate,"chunkFrames":config.chunkLen,"leftFrames":config.chunkLeftContext,"rightFrames":config.chunkRightContext,
     "fifoFrames":config.fifoLen,"cacheFrames":config.spkcacheLen,"cacheUpdateFrames":config.spkcacheUpdatePeriod,
     "silenceThreshold":config.silenceThreshold,"predScoreThreshold":config.predScoreThreshold,
     "scoresBoostLatest":config.scoresBoostLatest,"strongBoostRate":config.strongBoostRate,"weakBoostRate":config.weakBoostRate,
     "minimumPositiveScoresRate":config.minPosScoresRate,"silenceFramesPerSpeaker":config.spkcacheSilFramesPerSpk]
  }
  func process() throws -> DiarizerChunkResult? { try process(flush:false) }
  func finalizeSession() throws -> DiarizerChunkResult? { try process(flush:true) }
  func cleanup() { window = DeviceSpeakerPcmWindow(profile:profile); state = SortformerStreamingState(config:config) }

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
