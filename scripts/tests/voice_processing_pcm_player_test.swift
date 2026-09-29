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
    // Completed streaming chunks do not reset the reference node; explicit
    // cancellation still does, and a stale completion cannot finish a new one.
    let streamingNode = FakePcmNode(), streamingPlayer = VoiceProcessingPcmPlayer(node:streamingNode,format:output)
    try streamingPlayer.play(Data(repeating:0,count:3200),sampleRate:16000) { _ in }
    streamingNode.callbacks[0]()
    try streamingPlayer.play(Data(repeating:0,count:3200),sampleRate:16000) { _ in }
    precondition(streamingNode.stops == 0)
    streamingPlayer.stop();precondition(streamingNode.stops == 1)
    // Reference-only echo, independent speech, and mixed double-talk.
    let reference = PcmRenderReference()
    reference.reset(sessionId:"s",sampleRate:16000)
    var seed: UInt64 = 1
    let render: [Float] = (0..<16000).map { _ in seed = seed &* 6364136223846793005 &+ 1; return Float(Int(seed >> 48)-32768) / 65536 }
    reference.record(VoiceProcessingPcmPlayer.encode(render),sampleRate:16000,captureSample:0,sessionId:"s",acousticRoute:true)
    let echo = Array(render[4096..<8192]).map { $0 * 0.3 }
    let matchStarted = ProcessInfo.processInfo.systemUptime
    precondition(reference.match(echo,analysisStart:4096,sessionId:"s").matched)
    let matchMs = (ProcessInfo.processInfo.systemUptime-matchStarted)*1000
    print("HOST reference matching time for 256 ms input: \(matchMs) ms; not iPhone performance evidence")
    let near = (0..<4096).map { Float(sin(Double($0)*0.081) * 0.2) }
    precondition(!reference.match(near,analysisStart:4096,sessionId:"s").matched)
    let doubleTalk = zip(echo,near).map(+)
    precondition(!reference.match(doubleTalk,analysisStart:4096,sessionId:"s").matched)
    precondition(!reference.match(echo,analysisStart:4096,sessionId:"other").matched)
    precondition(!reference.match(echo,analysisStart:180000,sessionId:"s").matched)
    reference.reset(sessionId:"s",sampleRate:16000)
    precondition(!reference.match(echo,analysisStart:4096,sessionId:"s").matched)
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
