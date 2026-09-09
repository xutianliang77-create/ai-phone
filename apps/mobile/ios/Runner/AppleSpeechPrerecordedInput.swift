import Foundation
import CryptoKit

enum AppleSpeechPrerecordedError: String, Error, LocalizedError {
  case disabled = "prerecorded_input_disabled"
  case invalid = "prerecorded_input_invalid"
  case hashMismatch = "prerecorded_input_hash_mismatch"
  var errorDescription: String? { rawValue }
}

enum AppleSpeechInputPolicy {
  static var prerecordedEnabled: Bool {
    #if WUJIE_APPLE_FILE_PROBE
    true
    #else
    false
    #endif
  }

  static func requiresMicrophone(kind: String?, hasPrerecordedInput: Bool) throws -> Bool {
    if kind == nil && !hasPrerecordedInput { return true }
    guard kind == "prerecorded", hasPrerecordedInput else { throw AppleSpeechPrerecordedError.invalid }
    guard prerecordedEnabled else { throw AppleSpeechPrerecordedError.disabled }
    return false
  }
}

/// In-memory test input only: no file paths, URLs, reference text or resource bypass.
struct AppleSpeechPrerecordedInput {
  static let maximumBytes = 2_000_000
  let samples: [Float]
  let sha256: String

  init(wav: Data, expectedSHA256: String) throws {
    guard wav.count >= 44, wav.count <= Self.maximumBytes,
          expectedSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
      throw AppleSpeechPrerecordedError.invalid
    }
    let digest = SHA256.hash(data: wav).map { String(format: "%02x", $0) }.joined()
    guard digest == expectedSHA256 else { throw AppleSpeechPrerecordedError.hashMismatch }
    let bytes = [UInt8](wav)
    func u16(_ p: Int) -> Int { Int(bytes[p]) | (Int(bytes[p + 1]) << 8) }
    func u32(_ p: Int) -> Int { u16(p) | (u16(p + 2) << 16) }
    func tag(_ p: Int) -> String { String(bytes: bytes[p..<p + 4], encoding: .ascii) ?? "" }
    guard tag(0) == "RIFF", tag(8) == "WAVE", u32(4) == bytes.count - 8 else {
      throw AppleSpeechPrerecordedError.invalid
    }
    var offset = 12
    var formatSeen = false
    var audio: Range<Int>?
    while offset + 8 <= bytes.count {
      let kind = tag(offset), size = u32(offset + 4), start = offset + 8
      let end = start + size
      guard end <= bytes.count else { throw AppleSpeechPrerecordedError.invalid }
      if kind == "fmt " {
        guard !formatSeen, size >= 16, u16(start) == 1, u16(start + 2) == 1,
              u32(start + 4) == 16000, u32(start + 8) == 32000,
              u16(start + 12) == 2, u16(start + 14) == 16 else {
          throw AppleSpeechPrerecordedError.invalid
        }
        formatSeen = true
      } else if kind == "data" {
        guard audio == nil, size > 0, size.isMultiple(of: 2), size / 2 <= 960000 else {
          throw AppleSpeechPrerecordedError.invalid
        }
        audio = start..<end
      }
      offset = end + size % 2
    }
    guard offset == bytes.count, formatSeen, let audio else { throw AppleSpeechPrerecordedError.invalid }
    samples = stride(from: audio.lowerBound, to: audio.upperBound, by: 2).map {
      Float(Int16(bitPattern: UInt16(u16($0)))) / 32768
    }
    sha256 = digest
  }
}
