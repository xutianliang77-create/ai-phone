import Foundation

final class Loads: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0
  func load() -> Int {
    lock.lock(); count += 1; let result = count; lock.unlock()
    Thread.sleep(forTimeInterval: 0.05)
    return result
  }
  var calls: Int { lock.lock(); defer { lock.unlock() }; return count }
}
@main struct SpeakerPreparationTest {
  @MainActor static func main() async throws {
    let cache = DeviceSpeakerPreparationCache<Int>(), loads = Loads()
    async let first = cache.prepare { loads.load() }
    async let second = cache.prepare { loads.load() }
    let values = try await [first, second]
    precondition(values == [1, 1] && loads.calls == 1, "Concurrent callers must share one native load")
    let ready = try await cache.prepare { loads.load() }
    precondition(ready == 1 && loads.calls == 1, "Ready model must survive later settings rebuilds")

    let retry = DeviceSpeakerPreparationCache<Int>(), failures = Loads()
    do {
      _ = try await retry.prepare { _ = failures.load(); throw DeviceSpeakerFailure.resourcesMissing }
      preconditionFailure("Missing model cannot become ready")
    } catch DeviceSpeakerFailure.resourcesMissing { }
    let recovered = try await retry.prepare { failures.load() }
    precondition(recovered == 2 && failures.calls == 2, "Failed loads must permit retry")
    print("PASS native shared load, cached readiness, failure propagation, retry (4 checks; no model inference or microphone)")
  }
}
