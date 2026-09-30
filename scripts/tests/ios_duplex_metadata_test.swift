import AVFoundation
import Foundation

private final class MetadataPcmNode: VoiceProcessingPcmNode {
  var completion:(()->Void)?, stops=0
  func schedule(_ buffer:AVAudioPCMBuffer,completion:@escaping()->Void){self.completion=completion}
  func play(){}
  func stop(){stops += 1}
}
@main struct IosDuplexMetadataTest {
  static func main() throws {
    let data=try Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))
    let fixture=try JSONSerialization.jsonObject(with:data) as! [String:Any]
    precondition(fixture["scope"] as? String == "redacted_scalar_metadata_not_waveform_or_device_acceptance")
    let node=MetadataPcmNode(),format=AVAudioFormat(standardFormatWithSampleRate:48000,channels:1)!
    let player=VoiceProcessingPcmPlayer(node:node,format:format)
    var completions:[String]=[]
    try player.play(Data(repeating:0,count:25600),sampleRate:16000){completions.append($0 == nil ? "finished" : "cancelled")}
    let detector=CoreMlNemotronEndpointDetector(vadThreshold:0.6,vadNegativeThreshold:0.35,minSpeechMs:96,endpointSilenceMs:640)
    var gate=PcmRenderEchoGate()
    func decision(_ row:[String:Any],start:Int)->Bool {
      let echo=gate.evaluate(.init(matched:row["matched"] as! Bool,correlation:row["correlation"] as! Double,
        lagMs:row["lagMs"] as! Int,coverage:1,requiresEchoProof:true,referenceKnown:row["referenceKnown"] as! Bool),analysisStart:start,frameSamples:4096)
      return detector.acceptVadFrame(probability:row["probability"] as! Double,
        samples:[Float](repeating:Float(row["rms"] as! Double),count:4096),provider:"redacted_metadata_replay",
        speechStartAllowed:echo.speechStartAllowed).speechStarted
    }
    for n in 0..<6 { precondition(!decision(fixture["quiet"] as! [String:Any],start:n*4096)) }
    precondition(node.stops==0&&completions.isEmpty)
    let barge=fixture["barge"] as! [String:Any]
    if decision(barge,start:6*4096){player.stop()}
    precondition(node.stops==1&&completions==["cancelled"])
    precondition(!decision(barge,start:7*4096)) // no repeated start for one utterance
    try player.play(Data(repeating:0,count:3200),sampleRate:16000){completions.append($0 == nil ? "new-finished" : "new-cancelled")}
    node.completion?()
    precondition(completions==["cancelled","new-finished"])
    var unknown=PcmRenderEchoGate()
    precondition(!unknown.evaluate(.init(matched:false,correlation:0,lagMs:0,requiresEchoProof:true,referenceKnown:false),
      analysisStart:0,frameSamples:4096).speechStartAllowed)
    print("HOST_PASS quiet versus real-barge metadata, cancelled old generation, new playback completion; synthetic PCM, no microphone/model/device proof")
  }
}
