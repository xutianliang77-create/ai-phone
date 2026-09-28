import Foundation

@main struct OnlineEvidenceRecorderTests {
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("wujie-evidence-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let trace = CoreMlNemotronDiagnosticRecorder(metadataOnly: true, maximumTimelineEvents: 3, outputDirectory: root)
    trace.start(enabled: true, sessionId: "vad-test", configuration: ["kind": "online_vad_metadata"], modelDirectory: nil)
    trace.appendAudio([0.5, -0.5]) // Metadata mode must not retain even explicitly supplied PCM.
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
    let disabled = CoreMlNemotronDiagnosticRecorder(metadataOnly: true, outputDirectory: root)
    disabled.start(enabled: false, sessionId: "off", configuration: [:], modelDirectory: nil)
    disabled.record(type: "ignored"); disabled.appendAudio([1]); disabled.finish()
    precondition(disabled.payload()["lastEventCount"] as? Int == 0)
    print("HOST_PASS metadata-only bounded trace; no PCM file; private 1.0 recorder defaults preserved")
  }
}
