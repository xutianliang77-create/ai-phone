import AVFoundation
import Foundation

final class FakePcmNode: VoiceProcessingPcmNode {
  var buffers: [AVAudioPCMBuffer] = []
  var callbacks: [() -> Void] = []
  var plays = 0, stops = 0
  func schedule(_ buffer: AVAudioPCMBuffer, completion: @escaping () -> Void) {
    buffers.append(buffer); callbacks.append(completion)
  }
  func play() { plays += 1 }
  func stop() { stops += 1 }
}
@main struct VoiceProcessingPcmPlayerTest {
  static func main() throws {
    for mask in 0..<64 {
      let s = PcmCaptureReadiness(inputStarted:mask & 1 != 0,engineRunning:mask & 2 != 0,
        referenceBound:mask & 4 != 0,inputProcessing:mask & 8 != 0,outputProcessing:mask & 16 != 0,
        bypassed:mask & 32 != 0)
      precondition(s.ready == (mask == 31))
      precondition((s.payload["ready"] as? Bool) == s.ready)
      precondition((s.reason == nil) == s.ready)
    }
    precondition(PcmCaptureReadiness(inputStarted:true,engineRunning:false,referenceBound:true,
      inputProcessing:true,outputProcessing:true,bypassed:false).reason == "engine_not_running")
    precondition(PcmCaptureReadiness(inputStarted:true,engineRunning:true,referenceBound:true,
      inputProcessing:true,outputProcessing:true,bypassed:true).reason == "voice_processing_bypassed")
    let output = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
    let encoded = VoiceProcessingPcmPlayer.encode([-2,-1,-0.5,0,0.5,1,2,.infinity,.nan,.greatestFiniteMagnitude])
    precondition([UInt8](encoded) == [0,128,0,128,0,192,0,0,0,64,255,127,255,127,0,0,0,0,255,127])
    for rate in [16000,24000] {
      let step: Double = 2.0 * Double.pi * 440.0 / Double(rate)
      let samples: [Float] = (0..<(rate / 5)).map { Float(sin(Double($0) * step) * 0.3) }
      let pcm = VoiceProcessingPcmPlayer.encode(samples)
      let buffer = try VoiceProcessingPcmPlayer.buffer(pcm, sampleRate:rate, output:output)
      precondition(abs(Int(buffer.frameLength) - 9600) <= 1)
      precondition(buffer.format.sampleRate == 48000 && buffer.format.channelCount == 1)
      let channel = buffer.floatChannelData![0]
      precondition((0..<Int(buffer.frameLength)).allSatisfy { channel[$0].isFinite && abs(channel[$0]) < 0.5 })
      let same = try VoiceProcessingPcmPlayer.buffer(pcm, sampleRate:rate,
        output:AVAudioFormat(standardFormatWithSampleRate:Double(rate),channels:1)!)
      precondition(same.frameLength == samples.count)
      for routeRate in [8000,16000,24000,44100,48000] {
        let route = AVAudioFormat(standardFormatWithSampleRate:Double(routeRate),channels:1)!
        let converted = try VoiceProcessingPcmPlayer.buffer(pcm,sampleRate:rate,output:route)
        precondition(abs(Int(converted.frameLength) - routeRate / 5) <= 1)
      }
      let node = FakePcmNode(), player = VoiceProcessingPcmPlayer(node:node,format:output)
      var completed: [String] = []
      try player.play(pcm,sampleRate:rate) { completed.append($0 == nil ? "first-done" : "first-cancelled") }
      precondition(completed.isEmpty && node.plays == 1)
      player.stop()
      precondition(completed == ["first-cancelled"])
      try player.play(pcm,sampleRate:rate) { completed.append($0 == nil ? "second-done" : "second-cancelled") }
      node.callbacks[0]() // cancelled generation's late native completion
      precondition(completed == ["first-cancelled"])
      node.callbacks[1](); node.callbacks[1]()
      player.stop()
      precondition(completed == ["first-cancelled","second-done"])
      precondition(node.plays == 2)
    }
    for (data, rate) in [(Data(),16000),(Data([1]),16000),(Data([1,0]),8000)] {
      do { _ = try VoiceProcessingPcmPlayer.buffer(data,sampleRate:rate,output:output); fatalError("invalid PCM accepted") }
      catch { /* expected */ }
    }
    let mailbox = PublicPcmMailbox()
    mailbox.append(Data([1,0])); mailbox.append(Data([2,0]));
    precondition(mailbox.take().frames == [Data([1,0]),Data([2,0])])
    precondition(mailbox.take().frames.isEmpty)
    mailbox.append(Data(repeating:0,count:288_001))
    precondition(mailbox.take().errorCode == "public_capture_backpressure")
    mailbox.append(Data([3,0]))
    precondition(mailbox.take().errorCode == "public_capture_backpressure") // sticky failure, no silent resume
    let failed = PublicPcmMailbox()
    failed.append(Data([1,0])); failed.fail("audio_conversion_failed")
    precondition(failed.take().errorCode == "audio_conversion_failed")
    print("PASS: 16k/24k conversion, PCM saturation, played-back completion, cancellation and stale generation; no physical audio I/O")
  }
}
