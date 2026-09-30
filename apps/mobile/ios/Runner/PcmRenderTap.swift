import AVFoundation
import Foundation

/// One monitor on the node connected to the output, as recommended by
/// AVAudioNode's tap contract. This owns neither a microphone nor playback.
final class PcmRenderTap {
  private let reference: PcmRenderReference
  private let generation: UInt64
  private let queue = DispatchQueue(label:"translation_mobile.public_render_reference")
  private weak var engine: AVAudioEngine?
  private var active = false
  private(set) var installed = false

  init(reference: PcmRenderReference, generation: UInt64) {
    self.reference = reference; self.generation = generation
  }

  func install(on engine: AVAudioEngine) {
    stop()
    self.engine = engine; queue.sync { active = true }
    let rate = engine.mainMixerNode.outputFormat(forBus:0).sampleRate
    let size = AVAudioFrameCount(max(256,Int(ceil(rate*0.1))))
    engine.mainMixerNode.installTap(onBus:0,bufferSize:size,format:nil) { [weak self] buffer,time in
      guard let self, time.isHostTimeValid, let samples = Self.mono(buffer) else { return }
      let host = AVAudioTime.seconds(forHostTime:time.hostTime), rate = buffer.format.sampleRate
      let sampleTime: Int64? = time.isSampleTimeValid && time.sampleRate == rate ? time.sampleTime : nil
      self.queue.async {
        guard self.active else { return }
        #if os(iOS)
        let acoustic = AVAudioSession.sharedInstance().currentRoute.outputs.contains {
          [.builtInSpeaker,.builtInReceiver].contains($0.portType)
        }
        self.reference.updateRoute(acoustic:acoustic,generation:self.generation)
        #endif
        self.reference.recordRendered(samples,sampleRate:rate,hostTime:host,generation:self.generation,sampleTime:sampleTime)
      }
    }
    installed = true
  }

  func observeInput(endSample:Int, endTime:Double?) {
    guard let endTime, endTime.isFinite else {
      reference.invalidateClock(generation:generation); return
    }
    // Anchor publication does not queue behind render processing. It is a
    // short scalar update; no buffer matching or file I/O runs in an I/O tap.
    reference.observeInput(endSample:endSample,endTime:endTime,generation:generation)
  }

  // A graph may not render until its first PCM is scheduled. Capture/start
  // therefore needs the installed tap and input clock; speech-start evidence
  // still requires actual rendered samples in PcmRenderReference.match().
  var ready: Bool { installed && reference.inputClockReady }

  func stop() {
    if installed { engine?.mainMixerNode.removeTap(onBus:0); installed = false }
    queue.sync { active = false }
    engine = nil
  }

  static func mono(_ buffer: AVAudioPCMBuffer) -> [Float]? {
    guard buffer.format.commonFormat == .pcmFormatFloat32, buffer.frameLength > 0,
      buffer.format.sampleRate.isFinite, buffer.format.sampleRate >= 2000,
      let channels = buffer.floatChannelData else { return nil }
    let count = Int(buffer.frameLength), width = Int(buffer.format.channelCount)
    guard width > 0, width <= 32 else { return nil }
    var mono = [Float](repeating:0,count:count)
    for i in 0..<count { for c in 0..<width {
      let value = buffer.format.isInterleaved ? channels[0][i*width+c] : channels[c][i]
      mono[i] += value.isFinite ? value/Float(width) : 0
    } }
    return mono
  }
}
