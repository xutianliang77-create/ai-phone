import Foundation

@main struct SpeakerWindowTests {
  static func main() throws {
    // The frozen 1.0 clock must be independent of how the microphone packetizes
    // the same PCM. Include arbitrary, non-80ms input sizes and a short tail.
    for profile in DeviceSpeakerModelVariant.allCases {
      assert(profile.inputShapes["fifo"] == [1,profile == .fastest ? 40 : 188,512])
      assert(profile.cacheUpdateFrames == (profile == .fastest ? 31 : 144))
      let baseline=try profile.selectedCacheUpdateFrames(nil);assert(baseline==profile.cacheUpdateFrames)
    for packet in [1, 320, 480, 960, 16000] {
      var clock = DeviceSpeakerPcmWindow(profile:profile), covered = 0, peak = 0
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
    for candidate in [24,31,40] {
      let selected=try DeviceSpeakerModelVariant.fastest.selectedCacheUpdateFrames(candidate);assert(selected==candidate)
      assert(DeviceSpeakerModelVariant.fastest.inputShapes["fifo"]==[1,40,512])
    }
    for invalid in [-1,0,6,23,46,47,144] {
      do {_=try DeviceSpeakerModelVariant.fastest.selectedCacheUpdateFrames(invalid);assert(false)} catch { }
    }
    }
    print("PASS: 2 profiles x 5 packetizations, 120 seconds each; exact windows, bounded retention and no clock drift")
  }
}
