import Foundation
import CryptoKit

@main
struct AppleSpeechPrerecordedInputTest {
  static func hash(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  static func uint(_ n: Int, _ count: Int) -> [UInt8] {
    (0..<count).map { UInt8((n >> ($0 * 8)) & 255) }
  }
  static func chunk(_ name: String, _ body: [UInt8]) -> [UInt8] {
    Array(name.utf8) + uint(body.count, 4) + body + (body.count % 2 == 0 ? [] : [0])
  }
  static func wave(_ chunks: [[UInt8]]) -> Data {
    let body = Array("WAVE".utf8) + chunks.flatMap { $0 }
    return Data(Array("RIFF".utf8) + uint(body.count, 4) + body)
  }
  static func reject(_ bytes: Data, _ expected: AppleSpeechPrerecordedError = .invalid,
                     digest: String? = nil, line: UInt = #line) {
    do { _ = try AppleSpeechPrerecordedInput(wav: bytes, expectedSHA256: digest ?? hash(bytes))
      fatalError("Invalid input was accepted at test line \(line)")
    } catch let error as AppleSpeechPrerecordedError { precondition(error == expected) }
      catch { fatalError("Unexpected error: \(error)") }
  }
  static func main() throws {
    let format = uint(1, 2) + uint(1, 2) + uint(16000, 4) + uint(32000, 4) + uint(2, 2) + uint(16, 2)
    let fmt = chunk("fmt ", format)
    let audio = chunk("data", [0, 0, 255, 127, 0, 128])
    let valid = wave([fmt, chunk("JUNK", [1, 2, 3]), audio])
    let parsed = try AppleSpeechPrerecordedInput(wav: valid, expectedSHA256: hash(valid))
    precondition(parsed.samples == [0, Float(32767) / 32768, -1])
    reject(valid, .hashMismatch, digest: String(repeating: "0", count: 64))
    reject(valid, digest: "not-a-sha256")
    reject(Data(repeating: 0, count: 43))
    reject(Data(repeating: 0, count: 2_000_001))
    reject(wave([fmt, fmt, audio]))
    reject(wave([fmt, audio, audio]))
    reject(wave([fmt, chunk("data", [])]))
    reject(wave([fmt, chunk("data", [1])]))
    reject(wave([fmt, chunk("data", Array(repeating: 0, count: 1_920_002))]))
    reject(wave([audio]))
    reject(wave([fmt]))
    for (offset, value) in [(0, 3), (2, 2), (4, 17), (8, 1), (12, 4), (14, 8)] {
      var badFormat = format; badFormat[offset] = UInt8(value)
      reject(wave([chunk("fmt ", badFormat), audio]))
    }
    var overrun = valid; overrun[16] = 255; reject(overrun)
    var truncated = valid; truncated.removeLast(); reject(truncated)
    var trailing = valid; trailing.append(0); trailing.replaceSubrange(4..<8, with: uint(trailing.count - 8, 4)); reject(trailing)
    var wrongRiff = valid; wrongRiff[0] = 0; reject(wrongRiff)
    let normalUsesMicrophone = try AppleSpeechInputPolicy.requiresMicrophone(kind: nil, hasPrerecordedInput: false)
    precondition(normalUsesMicrophone)
    for (kind, hasInput) in [("microphone", true), ("prerecorded", false), (nil, true)] as [(String?, Bool)] {
      do { _ = try AppleSpeechInputPolicy.requiresMicrophone(kind: kind, hasPrerecordedInput: hasInput)
        fatalError("Malformed test input fell through to microphone")
      } catch AppleSpeechPrerecordedError.invalid {}
    }
    #if WUJIE_APPLE_FILE_PROBE
    precondition(AppleSpeechInputPolicy.prerecordedEnabled)
    let testUsesMicrophone = try AppleSpeechInputPolicy.requiresMicrophone(kind: "prerecorded", hasPrerecordedInput: true)
    precondition(!testUsesMicrophone)
    #else
    precondition(!AppleSpeechInputPolicy.prerecordedEnabled)
    do { _ = try AppleSpeechInputPolicy.requiresMicrophone(kind: "prerecorded", hasPrerecordedInput: true)
      fatalError("Production accepted test input")
    } catch AppleSpeechPrerecordedError.disabled {}
    #endif
    // Optional existing, locked synthetic fixture. No generated reference text enters ASR.
    if CommandLine.arguments.count == 4 {
      let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
      let fixture = try AppleSpeechPrerecordedInput(wav: data, expectedSHA256: CommandLine.arguments[2])
      precondition(fixture.samples.count == Int(CommandLine.arguments[3]))
    }
    print("PASS bounded PCM WAV, SHA, malformed/duplicate/oversized chunks, sample fidelity and prerecorded gate enabled=\(AppleSpeechInputPolicy.prerecordedEnabled)")
  }
}
