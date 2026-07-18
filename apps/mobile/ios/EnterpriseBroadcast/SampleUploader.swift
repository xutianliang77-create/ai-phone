import CFNetwork
import CoreImage
import Foundation
import ReplayKit

final class SampleUploader {
  private static let imageContext = CIContext(options: nil)
  private static let bufferMaxLength = 10_240

  @Atomic private var ready = false
  private let connection: SocketConnection
  private let queue = DispatchQueue(label: "ai.wujie.enterprise.broadcast.upload")
  private var dataToSend: Data?
  private var byteIndex = 0

  init(connection: SocketConnection) {
    self.connection = connection
    connection.didOpen = { [weak self] in self?.ready = true }
    connection.streamHasSpaceAvailable = { [weak self] in
      self?.queue.async { self?.sendNextChunk() }
    }
  }

  @discardableResult
  func send(sample: CMSampleBuffer) -> Bool {
    guard ready, let data = prepare(sample: sample) else { return false }
    ready = false
    dataToSend = data
    byteIndex = 0
    queue.async { [weak self] in self?.sendNextChunk() }
    return true
  }

  private func sendNextChunk() {
    guard let data = dataToSend else { return }
    let remaining = data.count - byteIndex
    let requested = min(remaining, Self.bufferMaxLength)
    let written = data[byteIndex..<(byteIndex + requested)].withUnsafeBytes {
      guard let pointer = $0.bindMemory(to: UInt8.self).baseAddress else { return 0 }
      return connection.write(buffer: pointer, maxLength: requested)
    }
    guard written > 0 else { return }
    byteIndex += written
    if byteIndex >= data.count {
      dataToSend = nil
      byteIndex = 0
      ready = true
    }
  }

  private func prepare(sample: CMSampleBuffer) -> Data? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else { return nil }
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let orientation = CMGetAttachment(
      sample,
      key: RPVideoSampleOrientationKey as CFString,
      attachmentModeOut: nil
    )?.uintValue ?? 0
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    let colorSpace = image.colorSpace ?? CGColorSpaceCreateDeviceRGB()
    guard let jpeg = Self.imageContext.jpegRepresentation(
      of: image,
      colorSpace: colorSpace,
      options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 1]
    ) else { return nil }
    let response = CFHTTPMessageCreateResponse(
      nil, 200, nil, kCFHTTPVersion1_1
    ).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(
      response, "Content-Length" as CFString, String(jpeg.count) as CFString
    )
    CFHTTPMessageSetHeaderFieldValue(
      response, "Buffer-Width" as CFString, String(width) as CFString
    )
    CFHTTPMessageSetHeaderFieldValue(
      response, "Buffer-Height" as CFString, String(height) as CFString
    )
    CFHTTPMessageSetHeaderFieldValue(
      response, "Buffer-Orientation" as CFString, String(orientation) as CFString
    )
    CFHTTPMessageSetBody(response, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(response)?.takeRetainedValue() as Data?
  }
}
