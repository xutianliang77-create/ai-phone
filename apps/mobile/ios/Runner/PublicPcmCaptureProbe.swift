import AVFoundation
import Foundation
import UIKit

/// Explicit QA launch inside the original App. Exercises the production input
/// and playback-reference graph; writes only counts/formats, never PCM or text.
@MainActor final class PublicPcmCaptureProbe {
  private static var retained: PublicPcmCaptureProbe?
  private let coordinator: AudioSessionCoordinator
  private var input: CoreMlNemotronAudioInput?
  private var changes: [[String: Any]] = []
  private var restarts = 0
  private let stats = CaptureProbeStats()

  static func startIfRequested(coordinator: AudioSessionCoordinator) {
    let env = ProcessInfo.processInfo.environment
    guard env["WUJIE_PUBLIC_PCM_QA"] == "1",
      env["WUJIE_PUBLIC_PCM_QA_SOURCE"] == Bundle.main.object(forInfoDictionaryKey:"WujieSourceCommit") as? String,
      let run = env["WUJIE_PUBLIC_PCM_QA_RUN"], run.range(of:"^[a-z0-9-]{1,80}$",options:.regularExpression) != nil else { return }
    let probe = PublicPcmCaptureProbe(coordinator:coordinator)
    retained = probe
    Task { await probe.run(run); retained = nil }
  }
  private init(coordinator: AudioSessionCoordinator) { self.coordinator = coordinator }

  private func run(_ run: String) async {
    let url = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0]
      .appendingPathComponent("wujie-public-pcm-qa-"+run+".json")
    let previousIdle = UIApplication.shared.isIdleTimerDisabled
    UIApplication.shared.isIdleTimerDisabled = true
    defer { UIApplication.shared.isIdleTimerDisabled = previousIdle }
    var report: [String: Any] = ["status":"waiting_for_existing_model_preparation",
      "sourceCommit":Bundle.main.object(forInfoDictionaryKey:"WujieSourceCommit") ?? "unknown",
      "candidateId":Bundle.main.object(forInfoDictionaryKey:"WujieCandidateId") ?? "unknown",
      "run":run,"modelCalls":0,"pcmRecorded":false,"durationPerCaseSeconds":10]
    func save() {
      do { let data = try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys])
        try data.write(to:url,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path)
      } catch { NSLog("Wujie PCM QA receipt failed: %@",String(describing:error)) }
    }
    save()
    // Keep the same preparation condition as the failed phone case. Loading
    // the existing speaker model in the normal UI is not another model call.
    try? await Task.sleep(nanoseconds:100_000_000_000)
    var cases: [[String: Any]] = []
    let productionOnly = ProcessInfo.processInfo.environment["WUJIE_PUBLIC_PCM_QA_MODE"] == "production"
    let modes = productionOnly ? [(false,true)] : [(false,false),(true,false)]
    for (keepGraph,automatic) in modes {
      changes = []; restarts = 0; stats.reset()
      var acquired = false
      var item: [String: Any] = ["mode":automatic ? "production_automatic_recovery" : keepGraph ? "resume_same_graph" : "observe_stop_without_rebuild"]
      do {
        guard AVAudioApplication.shared.recordPermission == .granted else { throw probeError("microphone_permission_required") }
        guard !coordinator.hasActiveAudio else { throw probeError("existing_capture_or_playback_busy") }
        try coordinator.beginCapture(owner:"flutter_realtime_capture",managedEngine:true)
        acquired = true
        let capture = CoreMlNemotronAudioInput(audioSessionCoordinator:coordinator,
          owner:"public_pcm_capture",sampleRate:16000,sharedPlaybackReference:true,
          configurationChanged: { [weak self] state in
            guard let self else { return }
            self.changes.append(state)
            if keepGraph && self.restarts < 3 {
              self.restarts += 1
              do { try self.input?.resume() } catch { self.changes.append(["resumeError":error.localizedDescription]) }
            }
          },recoverSharedConfiguration:automatic)
        input = capture
        try capture.start(chunkDurationMs:40,onRuntimeError:{[stats] code,_ in stats.fail(code)},onChunk:{[stats] samples in stats.accept(samples.count)})
        item["start"] = capture.configurationState()
        try await Task.sleep(nanoseconds:10_000_000_000)
        item["beforeStop"] = capture.configurationState()
        item["input"] = capture.payload();item["chunks"] = stats.payload()
      } catch { item["error"] = error.localizedDescription }
      item["configurationChanges"] = changes;item["sameGraphRestarts"] = restarts
      _ = input?.stop();input = nil
      if acquired { coordinator.endCapture(owner:"flutter_realtime_capture") }
      cases.append(item);report["cases"] = cases;save()
      try? await Task.sleep(nanoseconds:500_000_000)
    }
    report["status"] = "completed";save()
  }
  private func probeError(_ code:String) -> NSError { NSError(domain:"PublicPcmCaptureProbe",code:1,userInfo:[NSLocalizedDescriptionKey:code]) }
}

private final class CaptureProbeStats {
  private let lock = NSLock()
  private var chunks = 0, samples = 0
  private var began = ProcessInfo.processInfo.systemUptime
  private var first: Double?, last: Double?, maxGap = 0.0
  private var error: String?
  func reset() { lock.lock();defer { lock.unlock() };chunks=0;samples=0;first=nil;last=nil;maxGap=0;error=nil;began=ProcessInfo.processInfo.systemUptime }
  func accept(_ count:Int) { lock.lock();defer { lock.unlock() };let now=ProcessInfo.processInfo.systemUptime
    if let last { maxGap=max(maxGap,now-last) };if first == nil { first=now };last=now;chunks+=1;samples+=count }
  func fail(_ code:String) { lock.lock();defer { lock.unlock() };error=code }
  func payload() -> [String: Any] { lock.lock();defer { lock.unlock() };var value:[String:Any]=["chunks":chunks,"samples":samples,"maximumGapMs":maxGap*1000]
    if let first { value["firstChunkMs"]=(first-began)*1000 };if let last { value["lastChunkMs"]=(last-began)*1000 };if let error { value["error"]=error };return value }
}
