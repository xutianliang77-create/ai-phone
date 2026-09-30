import AVFoundation
import Foundation

@main struct PcmRenderClockTests {
  static func main() throws {
    var clock = PcmRenderClock()
    precondition(!clock.ready && clock.position(at:100,sampleRate:16000) == nil)
    precondition(clock.observeInput(endSample:3200,endTime:100.2,sampleRate:16000))
    precondition(abs(clock.position(at:100.5,sampleRate:16000)!-8000) < 0.001)
    precondition(clock.position(at:100.1,sampleRate:16000) == nil)
    precondition(!clock.observeInput(endSample:4800,endTime:100.3,sampleRate:16000))
    precondition(!clock.observeInput(endSample:1,endTime:99,sampleRate:16000))
    precondition(!clock.observeInput(endSample:6400,endTime:.nan,sampleRate:16000))
    precondition(clock.observeInput(endSample:6400,endTime:101.3,sampleRate:16000))
    precondition(clock.position(at:100.9,sampleRate:16000) == nil)

    var seed: UInt64 = 19
    let render: [Float] = (0..<32000).map { _ in
      seed = seed &* 6364136223846793005 &+ 1
      return Float(Int(seed >> 48)-32768)/65536
    }
    let echo = Array(render[0..<4096]).map { $0*0.3 }
    let near = (0..<4096).map { Float(sin(Double($0)*0.081))*0.4 }
    // Red baseline: a chunk submitted at sample 0 is not echo reference for
    // audio physically rendered 500 ms later. No threshold changes can fix its clock.
    let submitted = PcmRenderReference()
    submitted.reset(sessionId:"submitted",sampleRate:16000)
    submitted.record(VoiceProcessingPcmPlayer.encode(render),sampleRate:16000,
      captureSample:0,sessionId:"submitted",acousticRoute:true)
    precondition(!submitted.match(echo,analysisStart:8000,sessionId:"submitted").matched)

    let physical = PcmRenderReference()
    let epoch = physical.reset(sessionId:"physical",sampleRate:16000)
    physical.beginPlayback(acousticRoute:true,generation:epoch)
    let unknown = physical.match(near,analysisStart:8000,sessionId:"physical")
    precondition(unknown.requiresEchoProof && !unknown.referenceKnown && !unknown.matched)
    var gate = PcmRenderEchoGate()
    precondition(!gate.evaluate(unknown,analysisStart:8000,frameSamples:4096).speechStartAllowed)
    physical.observeInput(endSample:3200,endTime:100.2,generation:epoch)
    precondition(physical.inputClockReady && !physical.clockReady)
    let notRendered = physical.match(near,analysisStart:8000,sessionId:"physical")
    precondition(!notRendered.referenceKnown && !gate.evaluate(notRendered,
      analysisStart:8000,frameSamples:4096).speechStartAllowed)
    physical.recordRendered(render,sampleRate:16000,hostTime:100.5,generation:epoch)
    let exact = physical.match(echo,analysisStart:8000,sessionId:"physical")
    precondition(exact.matched && exact.correlation > 0.99 && exact.referenceKnown)
    let independent = physical.match(zip(echo,near).map(+),analysisStart:8000,sessionId:"physical")
    precondition(!independent.matched && independent.referenceKnown && independent.requiresEchoProof)
    precondition(gate.evaluate(independent,analysisStart:8000,frameSamples:4096).speechStartAllowed)
    let fragmented = PcmRenderReference()
    let fragmentedEpoch = fragmented.reset(sessionId:"fragmented",sampleRate:16000)
    fragmented.beginPlayback(acousticRoute:true,generation:fragmentedEpoch)
    fragmented.observeInput(endSample:3200,endTime:100.2,generation:fragmentedEpoch)
    // Actual taps use ~100 ms buffers, not one 2-second test buffer. Split a
    // reference bin at every boundary and retain its measured portions.
    for offset in stride(from:0,to:render.count,by:1600) {
      fragmented.recordRendered(Array(render[offset..<offset+1600]),sampleRate:16000,
        hostTime:100.500125+Double(offset)/16000,generation:fragmentedEpoch)
    }
    let fragmentedEcho = fragmented.match(echo,analysisStart:8000,sessionId:"fragmented")
    let fragmentedNear = fragmented.match(near,analysisStart:8000,sessionId:"fragmented")
    precondition(fragmentedEcho.matched && fragmentedEcho.referenceKnown)
    precondition(!fragmentedNear.matched && fragmentedNear.referenceKnown)
    fragmented.invalidateClock(generation:fragmentedEpoch)
    let invalidated = fragmented.match(near,analysisStart:8000,sessionId:"fragmented")
    precondition(!fragmented.clockReady && !invalidated.referenceKnown && invalidated.requiresEchoProof)
    // A lost 100 ms render callback remains unknown; no audio is fabricated.
    let missing = PcmRenderReference(), missingEpoch = missing.reset(sessionId:"missing",sampleRate:16000)
    missing.beginPlayback(acousticRoute:true,generation:missingEpoch)
    missing.observeInput(endSample:3200,endTime:100.2,generation:missingEpoch)
    missing.recordRendered(Array(render[0..<1600]),sampleRate:16000,hostTime:100.500125,generation:missingEpoch)
    let gap = missing.match(near,analysisStart:8000,sessionId:"missing")
    precondition(!gap.referenceKnown && gap.requiresEchoProof)
    physical.endPlayback(generation:epoch)
    precondition(!physical.match(near,analysisStart:40000,sessionId:"physical").requiresEchoProof)
    physical.beginPlayback(acousticRoute:false,generation:epoch)
    precondition(!physical.match(near,analysisStart:8000,sessionId:"physical").requiresEchoProof)
    precondition(!physical.match(echo,analysisStart:8000,sessionId:"physical").matched)
    physical.updateRoute(acoustic:true,generation:epoch)
    precondition(physical.match(echo,analysisStart:8000,sessionId:"physical").matched)

    let next = physical.reset(sessionId:"next",sampleRate:24000)
    physical.beginPlayback(acousticRoute:true,generation:next)
    physical.observeInput(endSample:2400,endTime:200.1,generation:epoch) // stale old capture
    physical.recordRendered(render,sampleRate:16000,hostTime:200.5,generation:epoch)
    physical.endPlayback(generation:epoch)
    let stale = physical.match(near,analysisStart:8000,sessionId:"next")
    precondition(!physical.clockReady && stale.requiresEchoProof && !stale.referenceKnown)
    physical.observeInput(endSample:2400,endTime:200.1,generation:next)
    physical.recordRendered(render,sampleRate:16000,hostTime:200.5,generation:next)
    precondition(physical.clockReady && physical.match(echo,analysisStart:8000,sessionId:"next").matched)
    physical.observeInput(endSample:4800,endTime:201.2,generation:next) // pause/route gap
    precondition(!physical.clockReady && !physical.match(echo,analysisStart:8000,sessionId:"next").matched)

    // Same capture axis with actual 44.1/48 kHz rendering. Stereo taps are
    // mixed correctly; no synthetic PCM is substituted for missing channels.
    for rate in [8000.0,16000,24000,44100,48000] {
      let format = AVAudioFormat(standardFormatWithSampleRate:rate,channels:2)!
      let buffer = AVAudioPCMBuffer(pcmFormat:format,frameCapacity:AVAudioFrameCount(rate))!
      buffer.frameLength = buffer.frameCapacity
      let a = buffer.floatChannelData![0], b = buffer.floatChannelData![1]
      for i in 0..<Int(buffer.frameLength) { a[i] = Float(sin(Double(i)/rate*600)); b[i] = a[i] }
      let mono = PcmRenderTap.mono(buffer)!
      precondition(mono.count == Int(rate) && mono[123] == a[123])
      let r = PcmRenderReference(), e = r.reset(sessionId:"rate",sampleRate:16000)
      r.beginPlayback(acousticRoute:true,generation:e)
      r.observeInput(endSample:1600,endTime:300.1,generation:e)
      r.recordRendered(mono,sampleRate:rate,hostTime:300.2,generation:e)
      let microphone = (0..<4096).map { Float(sin(Double($0)/16000*600))*0.3 }
      precondition(r.match(microphone,analysisStart:3200,sessionId:"rate").matched)
    }

    // This is the OUTER native bridge entry policy, not just the player's
    // inner completion policy tested before 3005.
    for mask in 0..<16 {
      let publicCapture = mask & 1 != 0, pending = mask & 2 != 0
      let privatePlayer = mask & 4 != 0, id = mask & 8 != 0
      let shouldStop = PcmPlaybackBoundary.shouldStopBeforePlay(publicCapture:publicCapture,
        pendingResult:pending,privatePlayer:privatePlayer,playbackId:id)
      precondition(shouldStop == (mask != 1))
    }
    precondition((physical.metadata["source"] as? String) == "main_mixer_host_clock")
    precondition(physical.metadata.values.allSatisfy { !($0 is Data) && !($0 is [Float]) })
    print("HOST_PASS actual render/capture clock, scheduling-delay red baseline, reference unknown, independent double-talk, route gap, epoch, rates/stereo and outer chunk-stop policy; no physical I/O")
  }
}
