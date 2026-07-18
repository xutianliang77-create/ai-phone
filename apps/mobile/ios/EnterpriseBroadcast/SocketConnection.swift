import Darwin
import Foundation
import OSLog

final class SocketConnection: NSObject {
  var didOpen: (() -> Void)?
  var didClose: ((Error?) -> Void)?
  var streamHasSpaceAvailable: (() -> Void)?

  private let filePath: String
  private var socketHandle: Int32 = -1
  private var address: sockaddr_un?
  private var inputStream: InputStream?
  private var outputStream: OutputStream?
  private var networkQueue: DispatchQueue?
  private var shouldKeepRunning = false

  init?(filePath: String) {
    self.filePath = filePath
    socketHandle = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socketHandle != -1 else { return nil }
    super.init()
  }

  func open() -> Bool {
    guard FileManager.default.fileExists(atPath: filePath),
          setupAddress(),
          connectSocket() else { return false }
    setupStreams()
    inputStream?.open()
    outputStream?.open()
    return true
  }

  func close() {
    shouldKeepRunning = false
    inputStream?.delegate = nil
    outputStream?.delegate = nil
    inputStream?.close()
    outputStream?.close()
    inputStream = nil
    outputStream = nil
  }

  func write(buffer: UnsafePointer<UInt8>, maxLength: Int) -> Int {
    outputStream?.write(buffer, maxLength: maxLength) ?? 0
  }

  private func setupAddress() -> Bool {
    var value = sockaddr_un()
    guard filePath.utf8.count < MemoryLayout.size(ofValue: value.sun_path) else {
      return false
    }
    value.sun_family = sa_family_t(AF_UNIX)
    _ = withUnsafeMutablePointer(to: &value.sun_path.0) { pointer in
      filePath.withCString { source in
        strncpy(pointer, source, filePath.utf8.count + 1)
      }
    }
    address = value
    return true
  }

  private func connectSocket() -> Bool {
    guard var value = address else { return false }
    let status = withUnsafePointer(to: &value) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(socketHandle, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    return status == 0
  }

  private func setupStreams() {
    var read: Unmanaged<CFReadStream>?
    var write: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, socketHandle, &read, &write)
    inputStream = read?.takeRetainedValue()
    outputStream = write?.takeRetainedValue()
    for stream in [inputStream, outputStream] {
      stream?.delegate = self
      stream?.setProperty(
        kCFBooleanTrue,
        forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String)
      )
    }
    scheduleStreams()
  }

  private func scheduleStreams() {
    shouldKeepRunning = true
    let queue = DispatchQueue.global(qos: .userInitiated)
    networkQueue = queue
    queue.async { [weak self] in
      self?.inputStream?.schedule(in: .current, forMode: .common)
      self?.outputStream?.schedule(in: .current, forMode: .common)
      while self?.shouldKeepRunning == true {
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.25))
      }
    }
  }

  private func notifyClosed(_ error: Error?) {
    didClose?(error)
  }
}

extension SocketConnection: StreamDelegate {
  func stream(_ stream: Stream, handle event: Stream.Event) {
    switch event {
    case .openCompleted where stream === outputStream:
      didOpen?()
    case .hasBytesAvailable where stream === inputStream:
      var buffer: UInt8 = 0
      if inputStream?.read(&buffer, maxLength: 1) == 0 &&
          stream.streamStatus == .atEnd {
        close()
        notifyClosed(nil)
      }
    case .hasSpaceAvailable where stream === outputStream:
      streamHasSpaceAvailable?()
    case .errorOccurred:
      let error = stream.streamError
      close()
      notifyClosed(error)
    default:
      break
    }
  }
}
