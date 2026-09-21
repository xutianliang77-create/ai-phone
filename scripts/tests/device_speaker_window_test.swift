import Foundation

@main struct SpeakerWindowTests {
  static func main() {
    // The frozen 1.0 clock must be independent of how the microphone packetizes
    // the same PCM. Include arbitrary, non-80ms input sizes and a short tail.
    for packet in [1, 320, 480, 960, 16000] {
      var clock = DeviceSpeakerPcmWindow(), covered = 0, peak = 0
      let samples = 16000*120+317
      for start in stride(from:0,to:samples,by:packet) {
        clock.append(Array(start..<min(start+packet,samples)).map(Float.init))
        while let part = clock.next(flush:false) {
          assert(part.startFrame*1280 == covered)
          assert(part.frames==6 && part.right==7 && part.melFrames<=112)
          assert(part.samples.first == Float((part.startFrame-part.left)*1280))
          assert(part.samples.last == Float((part.startFrame+part.frames+part.right)*1280-1))
          covered += part.frames*1280
        }
        peak=max(peak,clock.retainedSamples)
      }
      while let part=clock.next(flush:true) { assert(part.startFrame*1280==covered); covered += part.frames*1280 }
      assert(covered==(samples/1280)*1280 && clock.totalSamples==samples)
      assert(peak<=18000)
    }
    print("PASS: 5 packetizations, 120 seconds each, exact frozen-v1 sample windows; bounded retention and no clock drift")
  }
}
