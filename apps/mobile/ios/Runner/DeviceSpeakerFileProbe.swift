import CoreML
import CryptoKit
import Foundation
import UIKit
import Darwin

/// Explicit QA launch only, inside the original App. Reads synthetic/licensed
/// fixtures from its own sandbox; never opens a mic or contacts a model server.
enum DeviceSpeakerFileProbe {
  static func startIfRequested() {
    guard ProcessInfo.processInfo.environment["WUJIE_SPEAKER_QA"] == "1" else { return }
    Task.detached(priority: .userInitiated) { await run() }
  }
  private static func run() async {
    let root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("speaker-qa")
    let output = root.appendingPathComponent("result.json")
    var result: [String: Any] = ["status": "running", "modelRevision": DeviceSpeakerModelResources.revision,
      "profile": DeviceSpeakerModelResources.profile, "system": ProcessInfo.processInfo.operatingSystemVersionString,
      "sourceCommit": Bundle.main.object(forInfoDictionaryKey: "WujieSourceCommit") ?? "unknown",
      "candidateId": Bundle.main.object(forInfoDictionaryKey: "WujieCandidateId") ?? "unknown",
      "networkModelCalls": 0, "microphoneOpened": false]
    func save() { if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: output, options: .atomic) } }
    save()
    do {
      let data = try Data(contentsOf: root.appendingPathComponent("manifest.json"))
      guard let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let cases = manifest["cases"] as? [[String: Any]], !cases.isEmpty, cases.count <= 12 else { throw DeviceSpeakerFailure.invalidAudio }
      let loadStart = ProcessInfo.processInfo.systemUptime
      let model = try DeviceSpeakerModelResources.load()
      result["modelLoadMs"] = (ProcessInfo.processInfo.systemUptime - loadStart) * 1000
      var peakMemory = residentBytes()
      var reports: [[String: Any]] = []
      for item in cases {
        guard let id = item["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil,
          let rate = item["sampleRate"] as? Int, [16000, 24000].contains(rate),
          let expected = item["sha256"] as? String else { throw DeviceSpeakerFailure.invalidAudio }
        let pcm = try Data(contentsOf: root.appendingPathComponent(id + ".pcm"))
        guard !pcm.isEmpty, pcm.count % 2 == 0, pcm.count <= rate * 2 * 300,
          SHA256.hash(data: pcm).map({String(format:"%02x",$0)}).joined() == expected else { throw DeviceSpeakerFailure.invalidAudio }
        let engine = try DeviceSpeakerEngine(sessionId: id, sampleRate: rate, model: model)
        let started = ProcessInfo.processInfo.systemUptime
        var evidence: [[String: Any]] = [], calls: [Double] = []
        let chunk = rate / 50 * 2 // same 20ms PCM granularity as the mobile input
        for offset in stride(from: 0, to: pcm.count, by: chunk) {
          let end = min(offset + chunk, pcm.count), before = ProcessInfo.processInfo.systemUptime
          let values = try await engine.accept(pcm.subdata(in: offset..<end), startSample: offset / 2)
          calls.append((ProcessInfo.processInfo.systemUptime - before) * 1000)
          peakMemory = max(peakMemory, residentBytes())
          evidence.append(contentsOf: values.map(\.json))
          if item["realtime"] as? Bool == true {
            let target = started + Double(end / 2) / Double(rate)
            let remaining = target - ProcessInfo.processInfo.systemUptime
            if remaining > 0 { try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000)) }
          }
        }
        evidence.append(contentsOf: try await engine.finish().map(\.json))
        let diagnostics = await engine.diagnostics(), ordered = calls.sorted()
        reports.append(["id": id, "sha256": expected, "sampleRate": rate, "inputSamples": pcm.count / 2,
          "wallMs": (ProcessInfo.processInfo.systemUptime - started) * 1000,
          "diagnostics": diagnostics, "callP95Ms": ordered[Int(Double(ordered.count - 1) * 0.95)],
          "callMaxMs": ordered.last ?? 0, "thermalState": ProcessInfo.processInfo.thermalState.rawValue,
          "peakAppResidentBytes": peakMemory,
          "evidence": evidence])
        result["cases"] = reports; save()
      }
      result["status"] = "completed"
    } catch {
      result["status"] = "failed"
      result["error"] = String(describing: error)
    }
    save()
  }
  private static func residentBytes() -> UInt64 {
    var info = mach_task_basic_info(), count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let code = withUnsafeMutablePointer(to: &info) { pointer in
      pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
      }
    }
    return code == KERN_SUCCESS ? info.resident_size : 0
  }
}
