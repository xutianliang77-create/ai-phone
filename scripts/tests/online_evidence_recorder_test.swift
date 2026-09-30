import Foundation

@main struct OnlineEvidenceRecorderTests {
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("wujie-evidence-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let trace = CoreMlNemotronDiagnosticRecorder(metadataOnly: true, maximumTimelineEvents: 3, outputDirectory: root)
    trace.start(enabled: true, sessionId: "vad-test", configuration: ["kind": "online_vad_metadata"], modelDirectory: nil)
    trace.appendAudio([0.5, -0.5]) // Metadata mode must not retain even explicitly supplied PCM.
    precondition(!trace.appendPcm16(Data([0,128,255,127])))
    for n in 0..<5 { trace.record(type: "vad.frame", payload: ["startSample": n * 4096, "probability": 0.2]) }
    trace.finish()
    let payload = trace.payload(), jsonPath = payload["lastJsonPath"] as! String
    let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: jsonPath))) as! [String: Any]
    let audio = saved["audio"] as! [String: Any]
    precondition(audio["path"] is NSNull && audio["captured"] as? Bool == false && audio["samples"] as? Int == 0)
    precondition(saved["timelineTruncated"] as? Bool == true)
    precondition((saved["timeline"] as? [Any])?.count == 3)
    let files = try FileManager.default.contentsOfDirectory(atPath: root.path)
    let attributes = try FileManager.default.attributesOfItem(atPath: jsonPath)
    precondition(files.allSatisfy { $0.hasSuffix(".json") })
    precondition((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    let legacy = CoreMlNemotronDiagnosticRecorder(outputDirectory: root)
    legacy.start(enabled: true, sessionId: "legacy-test", configuration: [:], modelDirectory: nil)
    legacy.appendAudio([0.5, 0, -0.5]); legacy.finish()
    let legacyAudio = legacy.payload()["lastAudioPath"] as! String
    let legacyBytes = try Data(contentsOf: URL(fileURLWithPath: legacyAudio))
    precondition(legacyBytes.count == 44 + 6)
    let bounded = CoreMlNemotronDiagnosticRecorder(outputDirectory:root,maximumAudioSeconds:30)
    bounded.start(enabled:true,sessionId:"bounded-exact-pcm",configuration:[:],modelDirectory:nil)
    precondition(!bounded.appendPcm16(Data([1])))
    var wire = Data([0,128,255,127])
    wire.append(Data(repeating:0x23,count:16000*2*31))
    precondition(bounded.appendPcm16(wire))
    bounded.finish()
    let boundedPath=bounded.payload()["lastAudioPath"] as! String
    let boundedBytes=try Data(contentsOf:URL(fileURLWithPath:boundedPath))
    precondition(boundedBytes.count == 44+16000*2*30)
    precondition(boundedBytes.dropFirst(44) == wire.prefix(16000*2*30))
    precondition(bounded.payload()["audioTruncated"] as? Bool == true)
    precondition(!bounded.appendPcm16(Data([0,0])))
    let boundedAttributes=try FileManager.default.attributesOfItem(atPath:boundedPath)
    precondition((boundedAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    let source=String(repeating:"a",count:40)
    let env=["WUJIE_PUBLIC_AUDIO_QA_CAPTURE":"30","WUJIE_PUBLIC_AUDIO_QA_SOURCE":source,"WUJIE_PUBLIC_AUDIO_QA_RUN":"echo-case"]
    precondition(PublicAudioWaveformQa.requested(environment:[:],sourceCommit:source,bundleId:"cn.qkxy.wujieai.public") == nil)
    precondition(PublicAudioWaveformQa.requested(environment:env,sourceCommit:source,bundleId:"private.app") == nil)
    precondition(PublicAudioWaveformQa.requested(environment:env,sourceCommit:String(repeating:"b",count:40),bundleId:"cn.qkxy.wujieai.public") == nil)
    precondition(PublicAudioWaveformQa.requested(environment:env,sourceCommit:source,bundleId:"cn.qkxy.wujieai.public")?.run == "echo-case")
    let output=Data(repeating:0x45,count:640)
    precondition(PublicAudioWaveformQa.outputWithinWindow(output,captureSample:16000*30-100,sampleRate:16000).count == 200)
    precondition(PublicAudioWaveformQa.outputWithinWindow(output,captureSample:16000*30,sampleRate:16000).isEmpty)
    precondition(PublicAudioWaveformQa.outputWithinWindow(output,captureSample:-1,sampleRate:16000).isEmpty)
    precondition(PublicAudioWaveformQa.outputWithinWindow(output,captureSample:0,sampleRate:24000).isEmpty)
    let disabled = CoreMlNemotronDiagnosticRecorder(metadataOnly: true, outputDirectory: root)
    disabled.start(enabled: false, sessionId: "off", configuration: [:], modelDirectory: nil)
    disabled.record(type: "ignored"); disabled.appendAudio([1]); disabled.finish()
    precondition(disabled.payload()["lastEventCount"] as? Int == 0)
    print("HOST_PASS default metadata privacy; exact PCM QA capped at 30 seconds; source/bundle binding; legacy recorder defaults preserved")
  }
}
