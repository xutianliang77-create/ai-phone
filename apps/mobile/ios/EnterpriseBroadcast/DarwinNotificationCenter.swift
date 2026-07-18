import Foundation

enum DarwinNotification: String {
  case broadcastStarted = "iOS_BroadcastStarted"
  case broadcastStopped = "iOS_BroadcastStopped"
  case broadcastRequestStop = "iOS_BroadcastRequestStop"
}

private func enterpriseDarwinNotificationCallback(
  _ center: CFNotificationCenter?,
  _ observer: UnsafeMutableRawPointer?,
  _ name: CFNotificationName?,
  _ object: UnsafeRawPointer?,
  _ userInfo: CFDictionary?
) {
  guard let observer, let name else { return }
  let owner = Unmanaged<DarwinNotificationCenter>
    .fromOpaque(observer)
    .takeUnretainedValue()
  owner.receive(name.rawValue as String)
}

final class DarwinNotificationCenter {
  static let shared = DarwinNotificationCenter()

  private let center = CFNotificationCenterGetDarwinNotifyCenter()
  private var handlers: [String: () -> Void] = [:]
  private let lock = NSLock()

  func post(_ notification: DarwinNotification) {
    CFNotificationCenterPostNotification(
      center,
      CFNotificationName(notification.rawValue as CFString),
      nil,
      nil,
      true
    )
  }

  func observe(_ notification: DarwinNotification, handler: @escaping () -> Void) {
    removeObserver(notification)
    lock.lock()
    handlers[notification.rawValue] = handler
    lock.unlock()
    CFNotificationCenterAddObserver(
      center,
      Unmanaged.passUnretained(self).toOpaque(),
      enterpriseDarwinNotificationCallback,
      notification.rawValue as CFString,
      nil,
      .deliverImmediately
    )
  }

  func removeObserver(_ notification: DarwinNotification) {
    CFNotificationCenterRemoveObserver(
      center,
      Unmanaged.passUnretained(self).toOpaque(),
      CFNotificationName(notification.rawValue as CFString),
      nil
    )
    lock.lock()
    handlers.removeValue(forKey: notification.rawValue)
    lock.unlock()
  }

  fileprivate func receive(_ name: String) {
    lock.lock()
    let handler = handlers[name]
    lock.unlock()
    handler?()
  }
}
