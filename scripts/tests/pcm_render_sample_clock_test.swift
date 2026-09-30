import Foundation

@main struct PcmRenderSampleClockTests {
  static func main() {
    var clock = PcmRenderSampleClock()
    precondition(clock.stamp(sampleTime:0,sampleRate:16000,frames:1600,hostTime:100)!.hostTime == 100)
    let continuous = clock.stamp(sampleTime:1600,sampleRate:16000,frames:1600,hostTime:100.10001)!
    precondition(abs(continuous.hostTime-100.1)<1e-9 && !continuous.discontinuity)
    precondition(clock.stamp(sampleTime:1600,sampleRate:16000,frames:1600,hostTime:100.10002) == nil)
    precondition(clock.stamp(sampleTime:0,sampleRate:16000,frames:1600,hostTime:100.05) == nil)
    let gap = clock.stamp(sampleTime:4800,sampleRate:16000,frames:1600,hostTime:100.30003)!
    precondition(abs(gap.hostTime-100.3)<1e-9 && !gap.discontinuity)
    precondition(clock.metadata["sampleGapRanges"] as? Int == 1)
    let restart = clock.stamp(sampleTime:0,sampleRate:16000,frames:1600,hostTime:101)!
    precondition(restart.discontinuity && restart.hostTime == 101)
    precondition(clock.stamp(sampleTime:1600,sampleRate:24000,frames:2400,hostTime:101.1)!.discontinuity)
    precondition(clock.stamp(sampleTime:4000,sampleRate:24000,frames:2400,hostTime:102)!.discontinuity)
    precondition(clock.stamp(sampleTime:nil,sampleRate:24000,frames:2400,hostTime:102.1)!.discontinuity)
    precondition(clock.metadata["basis"] as? String == "host_only")
    precondition(clock.stamp(sampleTime:6400,sampleRate:24000,frames:2400,hostTime:102.2)!.discontinuity)
    precondition(clock.stamp(sampleTime:Int64.max,sampleRate:24000,frames:1,hostTime:102.3) == nil)
    precondition(clock.stamp(sampleTime:8800,sampleRate:24000,frames:0,hostTime:102.3) == nil)
    precondition(clock.stamp(sampleTime:8800,sampleRate:.nan,frames:2400,hostTime:102.3) == nil)
    precondition(clock.stamp(sampleTime:8800,sampleRate:24000,frames:2400,hostTime:.infinity) == nil)
    var negative = PcmRenderSampleClock()
    precondition(negative.stamp(sampleTime:-1600,sampleRate:16000,frames:1600,hostTime:99.9) != nil)
    precondition(negative.stamp(sampleTime:0,sampleRate:16000,frames:1600,hostTime:100) != nil)

    var seed:UInt64 = 19
    let rendered:[Float] = (0..<32000).map { _ in
      seed = seed &* 6364136223846793005 &+ 1
      return Float(Int(seed >> 48)-32768)/65536
    }
    let echo=Array(rendered[1600..<5696]).map { $0*0.3 }
    let near=(0..<4096).map { Float(sin(Double($0)*0.081))*0.4 }
    let old = PcmRenderReference(), fixed = PcmRenderReference()
    let oldEpoch=old.reset(sessionId:"old",sampleRate:16000), newEpoch=fixed.reset(sessionId:"fixed",sampleRate:16000)
    for (reference,owner,epoch) in [(old,"old",oldEpoch),(fixed,"fixed",newEpoch)] {
      reference.observeInput(endSample:3200,endTime:100.2,generation:epoch)
      reference.beginPlayback(acousticRoute:true,generation:epoch)
      for offset in stride(from:0,to:rendered.count,by:1600) {
        reference.recordRendered(Array(rendered[offset..<offset+1600]),sampleRate:16000,
          hostTime:100.500125+Double(offset)/16000+Double(offset/1600)*0.00001,generation:epoch,
          sampleTime:owner == "fixed" ? Int64(offset) : nil)
      }
    }
    let red=old.match(near,analysisStart:9600,sessionId:"old")
    precondition(!red.referenceKnown && red.requiresEchoProof)
    var oldGate=PcmRenderEchoGate()
    precondition(!oldGate.evaluate(red,analysisStart:9600,frameSamples:4096).speechStartAllowed)
    let fixedEcho=fixed.match(echo,analysisStart:9600,sessionId:"fixed")
    let fixedNear=fixed.match(zip(echo,near).map(+),analysisStart:9600,sessionId:"fixed")
    var gate=PcmRenderEchoGate()
    precondition(fixedEcho.matched && fixedEcho.referenceKnown)
    precondition(!gate.evaluate(fixedEcho,analysisStart:9600,frameSamples:4096).speechStartAllowed)
    precondition(!fixedNear.matched && fixedNear.referenceKnown)
    gate.reset()
    precondition(gate.evaluate(fixedNear,analysisStart:9600,frameSamples:4096).speechStartAllowed)
    let stats=fixed.metadata["renderClock"] as! [String:Any]
    precondition(stats["sampleTimeBuffers"] as? Int == 20 && stats["sampleGapRanges"] as? Int == 0)
    precondition((stats["maximumHostDriftMs"] as! Double) > 0.1)

    // A genuinely omitted 100 ms callback remains absent even when the
    // remaining sample positions are valid. Do not fill it with synthetic PCM.
    let missing=PcmRenderReference(), missingEpoch=missing.reset(sessionId:"missing",sampleRate:16000)
    missing.observeInput(endSample:3200,endTime:100.2,generation:missingEpoch)
    missing.beginPlayback(acousticRoute:true,generation:missingEpoch)
    for offset in [0,3200] {
      missing.recordRendered(Array(rendered[offset..<offset+1600]),sampleRate:16000,
        hostTime:100.500125+Double(offset)/16000,generation:missingEpoch,sampleTime:Int64(offset))
    }
    precondition(!missing.match(near,analysisStart:8000,sessionId:"missing").referenceKnown)
    let missingStats=missing.metadata["renderClock"] as! [String:Any]
    precondition(missingStats["sampleGapRanges"] as? Int == 1)

    // A render clock restart/route change cannot compare against an earlier
    // stream's samples, and stale capture callbacks cannot mutate the new one.
    fixed.recordRendered(Array(rendered.prefix(1600)),sampleRate:16000,hostTime:104,generation:newEpoch,sampleTime:0)
    precondition(!fixed.match(echo,analysisStart:9600,sessionId:"fixed").matched)
    let next=fixed.reset(sessionId:"next",sampleRate:16000)
    fixed.observeInput(endSample:3200,endTime:200.2,generation:next)
    fixed.beginPlayback(acousticRoute:true,generation:next)
    fixed.recordRendered(rendered,sampleRate:16000,hostTime:200.5,generation:newEpoch,sampleTime:0)
    precondition(!fixed.clockReady)
    fixed.recordRendered(Array(rendered.prefix(1600)),sampleRate:16000,hostTime:200.5,generation:next,sampleTime:0)
    precondition(fixed.clockReady)
    fixed.recordRendered(Array(rendered.prefix(2400)),sampleRate:24000,hostTime:201,generation:next,sampleTime:0)
    precondition(!fixed.match(echo,analysisStart:8000,sessionId:"next").matched)

    // Real mixer formats at 44.1/48 kHz and 16/24 kHz capture profiles.
    func signal(_ t:Double)->Float {
      Float(sin(t*2*Double.pi*113)*0.2+sin(t*2*Double.pi*271)*0.18+sin(t*2*Double.pi*449)*0.1)
    }
    for renderRate in [44100.0,48000] { for captureRate in [16000,24000] {
      let r=PcmRenderReference(), e=r.reset(sessionId:"rates",sampleRate:captureRate)
      r.observeInput(endSample:captureRate/5,endTime:100.2,generation:e)
      r.beginPlayback(acousticRoute:true,generation:e)
      let frames=Int(renderRate/10)
      for n in 0..<20 {
        let samples=(0..<frames).map { signal(Double(n)/10+Double($0)/renderRate) }
        r.recordRendered(samples,sampleRate:renderRate,hostTime:100.5+Double(n)/10+Double(n)*0.00001,
          generation:e,sampleTime:Int64(n*frames))
      }
      let voice=(0..<4096).map { signal(0.3+Double($0)/16000)*0.3 }
      let m=r.match(voice,analysisStart:12800,sessionId:"rates")
      precondition(m.matched && m.referenceKnown)
      precondition(r.match(near,analysisStart:12800,sessionId:"rates").referenceKnown)
    } }
    print("HOST_PASS: host-drift red/green, actual sample continuity, echo rejection and independent double-talk, real missing buffers, duplicate/stale callbacks, restart/rate/clock discontinuity and 44.1/48 kHz; no physical I/O")
  }
}
