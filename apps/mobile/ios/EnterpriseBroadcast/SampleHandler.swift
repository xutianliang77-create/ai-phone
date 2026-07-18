import Foundation
import OSLog
import ReplayKit

private let broadcastLog = Logger(
  subsystem: "ai.wujie.enterprise.broadcast",
  category: "ReplayKit"
)

final class SampleHandler: RPBroadcastSampleHandler {
  private let manifestName = "enterprise_replaykit_control.json"
  private var connection: SocketConnection?
  private var uploader: SampleUploader?
  private var connectTimer: DispatchSourceTimer?
  private var controlKey: ReplayKitControlKey?
  private var lastControlCheck = Date.distantPast
  private let finishLock = NSLock()
  @Atomic private var finishing = false

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    guard let manifest = readValidManifest(),
          let socketPath = socketFilePath(),
          let connection = SocketConnection(filePath: socketPath) else {
      finishOnce(message: "屏幕共享授权已失效。")
      return
    }
    controlKey = manifest.controlKey
    self.connection = connection
    uploader = SampleUploader(connection: connection)
    connection.didClose = { [weak self] _ in
      self?.finishOnce(message: "屏幕共享连接已结束。")
    }
    DarwinNotificationCenter.shared.observe(.broadcastRequestStop) { [weak self] in
      self?.finishOnce(message: "屏幕共享已停止。")
    }
    DarwinNotificationCenter.shared.post(.broadcastStarted)
    openConnection()
  }

  override func broadcastFinished() {
    cleanup()
  }

  override func processSampleBuffer(
    _ sampleBuffer: CMSampleBuffer,
    with sampleBufferType: RPSampleBufferType
  ) {
    guard sampleBufferType == .video, !finishing else { return }
    if Date().timeIntervalSince(lastControlCheck) >= 1 {
      lastControlCheck = Date()
      guard let current = readValidManifest(), current.controlKey == controlKey else {
        finishOnce(message: "屏幕共享授权已失效。")
        return
      }
    }
    uploader?.send(sample: sampleBuffer)
  }

  private func socketFilePath() -> String? {
    guard let group = appGroupIdentifier(),
          let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: group
          ) else { return nil }
    return container.appendingPathComponent("rtc_SSFD").path
  }

  private func openConnection() {
    let timer = DispatchSource.makeTimerSource(
      queue: DispatchQueue(label: "ai.wujie.enterprise.broadcast.connect")
    )
    timer.schedule(deadline: .now(), repeating: .milliseconds(100))
    timer.setEventHandler { [weak self, weak timer] in
      guard let self, !self.finishing else {
        timer?.cancel()
        return
      }
      if self.connection?.open() == true { timer?.cancel() }
    }
    connectTimer = timer
    timer.resume()
  }

  private func readValidManifest() -> ReplayKitControlManifest? {
    guard let group = appGroupIdentifier(),
          let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: group
          ),
          let data = try? Data(contentsOf: container.appendingPathComponent(manifestName))
    else { return nil }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    guard let manifest = try? decoder.decode(ReplayKitControlManifest.self, from: data),
          manifest.isValid else { return nil }
    return manifest
  }

  private func appGroupIdentifier() -> String? {
    guard let value = Bundle.main.object(
      forInfoDictionaryKey: "RTCAppGroupIdentifier"
    ) as? String, value.hasPrefix("group."), value.count <= 180 else {
      return nil
    }
    return value
  }

  private func finishOnce(message: String) {
    finishLock.lock()
    defer { finishLock.unlock() }
    guard !finishing else { return }
    finishing = true
    broadcastLog.info("ReplayKit broadcast ending")
    cleanup()
    finishBroadcastWithError(NSError(
      domain: RPRecordingErrorDomain,
      code: 10_001,
      userInfo: [NSLocalizedDescriptionKey: message]
    ))
  }

  private func cleanup() {
    connectTimer?.cancel()
    connectTimer = nil
    connection?.close()
    connection = nil
    uploader = nil
    controlKey = nil
    DarwinNotificationCenter.shared.removeObserver(.broadcastRequestStop)
    DarwinNotificationCenter.shared.post(.broadcastStopped)
  }
}

private struct ReplayKitControlManifest: Codable {
  let shareId: String
  let generation: Int
  let publisherIdentity: String
  let leaseExpiresAt: Date
  let controlNonce: String
  let enabled: Bool

  var controlKey: ReplayKitControlKey {
    ReplayKitControlKey(
      shareId: shareId.lowercased(),
      generation: generation,
      controlNonce: controlNonce.lowercased()
    )
  }

  var isValid: Bool {
    enabled && UUID(uuidString: shareId) != nil &&
      UUID(uuidString: controlNonce) != nil && generation > 0 &&
      publisherIdentity == "ent-share:\(shareId):g\(generation)" &&
      publisherIdentity.count <= 180 && leaseExpiresAt > Date() &&
      leaseExpiresAt <= Date().addingTimeInterval(600)
  }
}

private struct ReplayKitControlKey: Equatable {
  let shareId: String
  let generation: Int
  let controlNonce: String
}
