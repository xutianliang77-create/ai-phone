import Foundation
import CryptoKit

/// Replays raw fixed-model probabilities through the App's actual decoder.
/// Unlike an offline smoothing approximation, this preserves streaming holds.
@main struct DeviceSpeakerActivitySweep {
  static func main() throws {
    let args=CommandLine.arguments
    guard args.count==4,!FileManager.default.fileExists(atPath:args[3]) else { throw Failure.arguments }
    let raw=try Data(contentsOf:URL(fileURLWithPath:args[1])),settings=try Data(contentsOf:URL(fileURLWithPath:args[2]))
    guard let report=try JSONSerialization.jsonObject(with:raw) as? [String:Any],report["status"] as? String=="completed",
      let cases=report["cases"] as? [[String:Any]],!cases.isEmpty,cases.count<=12,
      let profiles=try JSONSerialization.jsonObject(with:settings) as? [[String:Any]],!profiles.isEmpty,profiles.count<=256 else { throw Failure.input }
    var variants:[[String:Any]]=[]
    for entry in profiles {
      guard let name=entry["name"] as? String else { throw Failure.input }
      let config=try DeviceSpeakerActivityConfiguration.fromJson(entry["activity"])
      var results:[[String:Any]]=[]
      for item in cases {
        guard let rows=item["probabilities"] as? [[NSNumber]],rows.count<=3750,
          rows.allSatisfy({$0.count==4}),let samples=item["inputSamples"] as? Int,
          item["sampleRate"] as? Int==16000,rows.count==samples/1280 else { throw Failure.input }
        let frames=rows.map{$0.map(\.floatValue)}
        var decoder=DeviceSpeakerActivityDecoder(configuration:config),values:[Float]=[]
        for start in stride(from:0,to:frames.count,by:6){
          let result=try decoder.consume(frames[start..<min(start+6,frames.count)].flatMap{$0},startFrame:start)
          guard result.startFrame==values.count/4 else { throw Failure.clock };values += result.probabilities
        }
        let tail=decoder.flush();guard tail.startFrame==values.count/4 else { throw Failure.clock };values += tail.probabilities
        guard values.count==frames.count*4 else { throw Failure.clock }
        var spans:[[String:Any]]=[]
        for speaker in 0..<4 {
          var start:Int?
          for frame in 0...frames.count {
            let active=frame<frames.count && values[frame*4+speaker]>0
            if active,start==nil { start=frame }
            if !active,let first=start {
              spans.append(["speakerId":"speaker_\(speaker+1)","startMs":first*80,"endMs":frame*80]);start=nil
            }
          }
        }
        results.append(["id":item["id"] ?? "", "sha256":item["sha256"] ?? "", "inputSamples":samples,
          "durationMs":Double(samples)/16,"predicted":spans])
      }
      variants.append(["name":name,"activity":config.json,"decoderHoldMs":max(config.minimumOnFrames,config.minimumOffFrames)*80,"cases":results])
    }
    let result:[String:Any]=["status":"completed","profile":report["profile"] ?? "", "modelRevision":report["modelRevision"] ?? "",
      "manifestSha256":report["manifestSha256"] ?? "",
      "cacheUpdateFrames":report["cacheUpdateFrames"] ?? NSNull(),
      "inferenceSettings":report["inferenceSettings"] ?? [:],
      "rawSha256":SHA256.hash(data:raw).map{String(format:"%02x",$0)}.joined(),
      "settingsSha256":SHA256.hash(data:settings).map{String(format:"%02x",$0)}.joined(),"variants":variants]
    try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:args[3]),options:.withoutOverwriting)
    print("PASS: \(variants.count) configurations / \(cases.count) cases / original Swift activity decoder")
  }
  enum Failure:Error{case arguments,input,clock}
}
