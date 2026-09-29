import Foundation

/// Filters configuration notifications by capture ownership and generation.
/// This never starts or stops an engine. Its own lock lets notification callbacks
/// take a token without reentering the coordinator's AVAudioSession lock.
final class CaptureEngineInvalidationGate<Engine: AnyObject> {
  private let lock = NSLock()
  private var active = false
  private var managed = false
  private var generation: UInt64 = 0
  private weak var current: Engine?
  private weak var lastInvalidated: Engine?
  private let managedEngines = NSHashTable<AnyObject>.weakObjects()

  func begin(managed: Bool) {
    lock.lock(); defer { lock.unlock() }
    guard !active || self.managed != managed else { return }
    active = true
    self.managed = managed
    generation &+= 1
    lastInvalidated = nil
  }

  func end() {
    lock.lock(); defer { lock.unlock() }
    active = false
    generation &+= 1
    lastInvalidated = nil
  }

  func bind(_ engine: Engine) {
    lock.lock(); defer { lock.unlock() }
    managedEngines.add(engine)
    current = engine
    generation &+= 1
    lastInvalidated = nil
  }

  @discardableResult func unbind(_ engine: Engine) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard current === engine else { return false }
    current = nil
    generation &+= 1
    lastInvalidated = nil
    return true
  }

  // Snapshot on the notification's queue, then recheck on the main queue.
  // An old queued notification cannot invalidate a replacement capture.
  func token(for engine: Engine) -> UInt64? {
    lock.lock(); defer { lock.unlock() }
    guard active, belongsToCapture(engine) else { return nil }
    return generation
  }

  func shouldInvalidate(_ engine: Engine, token: UInt64,
                        isRunning: Bool, interrupted: Bool) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard active, generation == token, belongsToCapture(engine),
          !isRunning, !interrupted, lastInvalidated !== engine else { return false }
    lastInvalidated = engine
    return true
  }

  private func belongsToCapture(_ engine: Engine) -> Bool {
    if managed { return current === engine }
    // Legacy record/device-ASR retains its existing notification path, but a
    // retired public graph must not trigger it after a mode/session switch.
    return !managedEngines.contains(engine)
  }
}
