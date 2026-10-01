import AVFoundation
import Foundation

@main struct PcmEchoResidualStartTest {
  static var checks = 0
  static func require(_ ok: Bool, _ message: String) {
    checks += 1
    if !ok { fputs("FAIL: \(message)\n", stderr); exit(1) }
  }
  static func evaluate(_ gate: inout PcmRenderEchoGate, _ match: PcmRenderReference.Match,
    start: Int, rms: Double, open: Bool = false, frame: Int = 4096) -> PcmRenderEchoGate.Decision {
    #if ECHO_LEGACY_API
    // Red run only: same recorded observations, original pre-fix method.
    return gate.evaluate(match, analysisStart:start, frameSamples:frame)
    #else
    return gate.evaluate(match, analysisStart:start, frameSamples:frame,
      speechAlreadyOpen:open, inputRms:rms)
    #endif
  }
  static func match(_ correlation: Double, lag: Int = -82, proof: Bool = true,
    known: Bool = true) -> PcmRenderReference.Match {
    .init(matched:correlation >= 0.46,correlation:correlation,lagMs:lag,
      coverage:1,requiresEchoProof:proof,referenceKnown:known)
  }
  static func seeded(rms: Double = 0.09522460617989972, frame: Int = 4096,
    proof: Bool = true) -> PcmRenderEchoGate {
    var gate=PcmRenderEchoGate()
    _=evaluate(&gate,match(0.6798334337055238,lag:-83,proof:proof),start:0,rms:rms,frame:frame)
    return gate
  }
  static func replay(_ path: String) throws -> Int {
    let data=try Data(contentsOf:URL(fileURLWithPath:path))
    let fixture=try JSONSerialization.jsonObject(with:data) as! [String:Any]
    require(fixture["scope"] as? String == "redacted_scalar_metadata_not_waveform_or_device_acceptance", "fixture scope")
    let rows=fixture["rows"] as! [[NSNumber]],expected=fixture["expectedRetainedStarts"] as! [Int]
    var gate=PcmRenderEchoGate(),activity=AppleSpeechActivityGate(preRollSamples:12800)
    let endpoint=CoreMlNemotronEndpointDetector(vadThreshold:0.6,vadNegativeThreshold:0.35,minSpeechMs:96,endpointSilenceMs:640)
    var starts:[Int]=[],echoRanges:[Range<Int>]=[],through=0
    for row in rows {
      require(row.count == 9, "complete scalar row")
      let start=row[0].intValue,rms=row[2].doubleValue
      require(start == through, "contiguous 16k analysis samples")
      let m=PcmRenderReference.Match(matched:row[3].doubleValue >= 0.46,correlation:row[3].doubleValue,
        lagMs:row[4].intValue,coverage:row[5].doubleValue,
        requiresEchoProof:row[7].boolValue,referenceKnown:row[6].boolValue)
      let echo=evaluate(&gate,m,start:start,rms:rms,open:endpoint.isSpeechOpen)
      if fixture["falseStartSample"] as? Int == start {
        require(!echo.speechStartAllowed, "0102 fading same-lag echo must not start an interruption")
        require(!echo.matched && !echo.carried, "deferred residual is not fabricated positive echo evidence")
      }
      let decision=endpoint.acceptVadFrame(probability:row[1].doubleValue,
        samples:[Float](repeating:Float(rms),count:4096),provider:"redacted_scalar_replay",
        speechStartAllowed:echo.speechStartAllowed)
      through=start+4096
      if decision.speechStarted { starts.append(start) }
      activity.advance(through:through,speechEvent:decision.speechStarted ? (true,through) :
        decision.shouldFinalize ? (false,through-decision.trailingSilenceSamples) : nil)
      if echo.matched { echoRanges.append(start..<through) }
    }
    require(starts == expected, "all genuine/previously accepted onsets retained at original samples")
    activity.finish()
    if fixture["falseStartSample"] != nil {
      let evidence=appleOnlineAudioEvidence(sessionMatches:true,inputSampleRate:16000,
        range:["startSample":165920,"endSample":183840,"sampleRate":16000],
        analysedThrough:through,retainedFrom:0,activity:activity,renderEchoRanges:echoRanges)
      require(evidence["decision"] as? String == "non_speech", "0102 false transcript has no positive speech evidence")
      require(evidence["reason"] as? String == "no_speech_support", "uncertain frame is not labelled proven render echo")
    }
    return rows.count
  }
  static func boundaries() {
    // Only the immediately adjacent fading frame is deferred. A carried or
    // deferred frame cannot restart the hold, even with sustained same-lag voice.
    var gate=seeded()
    let first=evaluate(&gate,match(0.21754),start:4096,rms:0.03317)
    require(!first.speechStartAllowed && !first.matched, "adjacent fading frame deferred")
    #if !ECHO_LEGACY_API
    require(first.residualStartDeferred, "diagnostics distinguish deferred onset from matched echo")
    #endif
    for n in 2...5 { require(evaluate(&gate,match(0.21754),start:n*4096,rms:0.03317).speechStartAllowed,
      "sustained near voice released without extending hold") }
    for (rms,lag) in [(0.12,-82),(0.0001,90)] {
      var near=seeded()
      require(evaluate(&near,match(0.21754,lag:lag),start:4096,rms:rms).speechStartAllowed,
        "stronger or independently delayed single-frame barge-in remains immediate")
    }
    var open=seeded()
    require(evaluate(&open,match(0.21754),start:4096,rms:0.03317,open:true).speechStartAllowed,
      "already-open near utterance is not cut off by new onset protection")
    var noEcho=PcmRenderEchoGate()
    require(evaluate(&noEcho,match(0.21754),start:4096,rms:0.03317).speechStartAllowed,
      "no direct echo seed means no residual hold")
    var route=seeded()
    require(evaluate(&route,match(0.21754,proof:false),start:4096,rms:0.03317).speechStartAllowed,
      "headset/non-acoustic route is unaffected")
    var nonAcousticSeed=seeded(proof:false)
    require(evaluate(&nonAcousticSeed,match(0.21754),start:4096,rms:0.03317).speechStartAllowed,
      "non-acoustic seed cannot create a later acoustic hold")
    var stale=seeded();stale.reset()
    require(evaluate(&stale,match(0.21754),start:4096,rms:0.03317).speechStartAllowed,
      "new session does not reuse prior echo")
    var unknown=seeded()
    require(!evaluate(&unknown,match(0.21754,known:false),start:4096,rms:0.03317).speechStartAllowed,
      "unknown render reference still fails closed")
    var gap=seeded()
    require(evaluate(&gap,match(0.21754),start:8192,rms:0.03317).speechStartAllowed,
      "missing analysis window does not pretend continuity")
    var oversized=seeded(frame:8192)
    require(evaluate(&oversized,match(0.21754),start:8192,rms:0.03317,frame:8192).speechStartAllowed,
      "new hold cannot exceed the inherited 350ms bound")
    var reset=seeded()
    _=evaluate(&reset,match(0.21754),start:4096,rms:0.03317)
    reset.reset()
    require(evaluate(&reset,match(0.21754),start:0,rms:0.03317).speechStartAllowed,
      "off/end/restart reset does not leave a stuck guard")
    for rms in [Double.nan,Double.infinity,-0.1] {
      var invalid=seeded(rms:rms)
      require(evaluate(&invalid,match(0.21754),start:4096,rms:0.03).speechStartAllowed,
        "invalid energy is never used to infer a residual")
    }
  }
  static func continuedNearSpeech() {
    var gate=seeded(),activity=AppleSpeechActivityGate(preRollSamples:12800)
    let detector=CoreMlNemotronEndpointDetector(vadThreshold:0.6,vadNegativeThreshold:0.35,minSpeechMs:96,endpointSilenceMs:640)
    var starts:[Int]=[]
    for n in 1...4 {
      let start=n*4096
      let echo=evaluate(&gate,match(0.21754),start:start,rms:0.03317,open:detector.isSpeechOpen)
      let state=detector.acceptVadFrame(probability:0.99,samples:[Float](repeating:0.03317,count:4096),
        provider:"synthetic_same_lag_barge",speechStartAllowed:echo.speechStartAllowed)
      if state.speechStarted { starts.append(start) }
      activity.advance(through:start+4096,speechEvent:state.speechStarted ? (true,start+4096) : nil)
    }
    require(starts == [8192], "ambiguous sustained barge starts after one 256ms confirmation frame only")
    let firstWords=appleOnlineAudioEvidence(sessionMatches:true,inputSampleRate:16000,
      range:["startSample":4096,"endSample":8192,"sampleRate":16000],analysedThrough:20480,retainedFrom:0,
      activity:activity,renderEchoRanges:[])
    require(firstWords["decision"] as? String == "speech", "existing pre-roll preserves deferred first-word evidence")
    var fresh=PcmRenderEchoGate()
    let initial=evaluate(&fresh,match(0.05,proof:false),start:0,rms:0.0001)
    require(initial.speechStartAllowed,"quiet short near speech outside playback is unchanged")
  }
  static func main() throws {
    require(CommandLine.arguments.count == 4,"all three original metadata fixtures required")
    var frames=0
    for path in CommandLine.arguments.dropFirst() { frames += try replay(path) }
    boundaries();continuedNearSpeech()
    print("HOST_PASS \(frames) recorded scalar frames + \(checks) checks: fading echo onset, actual quiet/barge, bounded wait, original pre-roll and independent short speech; no microphone/model/device proof")
  }
}
