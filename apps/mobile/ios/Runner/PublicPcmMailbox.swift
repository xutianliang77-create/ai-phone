import Foundation

/// Small per-capture handoff between the inherited input queue and Flutter's
/// main queue. An overflow fails capture; it never silently drops accepted PCM.
final class PublicPcmMailbox {
  private let lock = NSLock()
  private var frames: [Data] = []
  private var bytes = 0
  private var errorCode: String?
  func append(_ data: Data) {
    lock.lock(); defer { lock.unlock() }
    guard !data.isEmpty, errorCode == nil else { return }
    if bytes + data.count > 288_000 { errorCode = "public_capture_backpressure"; return }
    bytes += data.count; frames.append(data)
  }
  func fail(_ code: String) {
    lock.lock(); defer { lock.unlock() }
    errorCode = errorCode ?? code
  }
  func take() -> (frames: [Data], errorCode: String?) {
    lock.lock(); defer { lock.unlock() }
    let result = (frames, errorCode)
    frames = []; bytes = 0
    return result
  }
}
