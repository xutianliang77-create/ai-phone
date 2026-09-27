import Foundation
import CoreML
import CryptoKit
import FluidAudio
import Darwin

/// HOST-only runner of the original App's window/state/activity code. No mic,
/// network, uploads, downloads, enrollment or production profile selection.
@main struct DeviceSpeakerCoreMlProbe {
  static func main() throws {
    let args=CommandLine.arguments
    guard [5,6].contains(args.count),let profile=DeviceSpeakerModelVariant(rawValue:args[1]),
      !FileManager.default.fileExists(atPath:args[4]) else { throw Failure.arguments }
    let cacheUpdate:Int?
    if args.count==6 { guard let integer=Int(args[5]) else { throw Failure.arguments };cacheUpdate=integer }
    else { cacheUpdate=nil }
    let selectedCache=try profile.selectedCacheUpdateFrames(cacheUpdate)
    let root=URL(fileURLWithPath:args[2]),manifestURL=URL(fileURLWithPath:args[3]),output=URL(fileURLWithPath:args[4])
    let manifestData=try Data(contentsOf:manifestURL)
    guard let manifest=try JSONSerialization.jsonObject(with:manifestData) as? [String:Any],
      let cases=manifest["cases"] as? [[String:Any]],!cases.isEmpty,cases.count<=12 else { throw Failure.manifest }
    var report:[String:Any]=["status":"running","evidenceLevel":"HOST_COREML_FILE_ONLY","profile":profile.rawValue,
      "modelRevision":DeviceSpeakerModelResources.revision,"manifestSha256":sha(manifestData),
      "cacheUpdateFrames":selectedCache,
      "inputShapes":profile.inputShapes,"system":ProcessInfo.processInfo.operatingSystemVersionString,
      "computeUnits":"cpuAndNeuralEngine","microphoneOpened":false,"networkModelCalls":0,"cases":[],
      "sourceBinding":manifest["sourceBinding"] ?? [:]]
    func save() throws { try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:output,options:.atomic) }
    try save()
    do {
      let verified=try DeviceSpeakerModelResources.verify(directory:root,profile:profile)
      let configuration=MLModelConfiguration();configuration.computeUnits = .cpuAndNeuralEngine
      let before=ProcessInfo.processInfo.systemUptime,model=try MLModel(contentsOf:verified,configuration:configuration)
      report["modelLoadMs"]=(ProcessInfo.processInfo.systemUptime-before)*1000;try save()
      var results:[[String:Any]]=[]
      for item in cases {
        guard let id=item["id"] as? String,id.range(of:"^[A-Za-z0-9_-]{1,80}$",options:.regularExpression) != nil,
          let rate=item["sampleRate"] as? Int,rate==16000,let hash=item["sha256"] as? String else { throw Failure.manifest }
        let pcm=try Data(contentsOf:manifestURL.deletingLastPathComponent().appendingPathComponent(id+".pcm"))
        guard !pcm.isEmpty,pcm.count%2==0,pcm.count<=16000*2*300,sha(pcm)==hash else { throw Failure.input }
        let bytes=[UInt8](pcm),samples=stride(from:0,to:bytes.count,by:2).map{Float(Int16(bitPattern:UInt16(bytes[$0])|UInt16(bytes[$0+1])<<8))/32768}
        let runtime=try DeviceSpeakerStreamingRuntime(model:model,profile:profile,cacheUpdateFrames:cacheUpdate)
        report["inferenceSettings"]=runtime.inferenceSettings
        var raw:[Float]=[],calls:[Double]=[],peak=residentBytes()
        func collect(_ chunk:DiarizerChunkResult?) throws {
          guard let chunk else { return }
          guard chunk.startFrame==raw.count/4,chunk.finalizedPredictions.count==chunk.finalizedFrameCount*4 else { throw Failure.clock }
          raw.append(contentsOf:chunk.finalizedPredictions)
        }
        report["currentCase"]=id;try save()
        let started=ProcessInfo.processInfo.systemUptime
        for offset in stride(from:0,to:samples.count,by:320) {
          let began=ProcessInfo.processInfo.systemUptime
          runtime.addAudio(Array(samples[offset..<min(offset+320,samples.count)]));try collect(runtime.process())
          calls.append((ProcessInfo.processInfo.systemUptime-began)*1000);peak=max(peak,residentBytes())
        }
        try collect(runtime.finalizeSession())
        guard raw.count/4==samples.count/1280 else { throw Failure.clock }
        let wallMs=(ProcessInfo.processInfo.systemUptime-started)*1000,sorted=calls.sorted()
        let probabilities=stride(from:0,to:raw.count,by:4).map{Array(raw[$0..<$0+4])}
        results.append(["id":id,"sampleRate":rate,"sha256":hash,"inputSamples":samples.count,
          "durationMs":Double(samples.count)/16,"frameMs":80,"probabilities":probabilities,
          "reference":item["reference"] ?? [],"referenceBasis":item["referenceBasis"] ?? "existing frozen fixture",
          "wallMs":wallMs,"rtf":wallMs/(Double(samples.count)/16),"peakProcessResidentBytes":peak,
          "callP95Ms":sorted[Int(Double(sorted.count-1)*0.95)],"callMaxMs":sorted.last ?? 0])
        runtime.cleanup();report["cases"]=results;try save()
        print("Completed \(profile.rawValue) / \(id) / \(raw.count/4) frames");fflush(stdout)
      }
      report["status"]="completed";report.removeValue(forKey:"currentCase");try save()
    } catch {report["status"]="failed";report["error"]=String(describing:error);try save();throw error}
  }
  static func sha(_ data:Data)->String { SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined() }
  static func residentBytes()->UInt64 {
    var info=mach_task_basic_info(),count=mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size/MemoryLayout<natural_t>.size)
    let result=withUnsafeMutablePointer(to:&info){p in p.withMemoryRebound(to:integer_t.self,capacity:Int(count)){
      task_info(mach_task_self_,task_flavor_t(MACH_TASK_BASIC_INFO),$0,&count)}}
    return result==KERN_SUCCESS ? info.resident_size : 0
  }
  enum Failure:Error {case arguments,manifest,input,clock}
}
