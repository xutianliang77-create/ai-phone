import Foundation
// Compile beside the actual product guard. No Flutter, model or device runtime.
@main struct NativeGuardTests {
 static func main() throws {
  let input=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))) as! [String:Any]
  var time=100.0,passed=[String]()
  func guardInstance(_ launch:String="launch-fixture") throws -> V10DeviceLicenseGuard {
   try V10DeviceLicenseGuard(ownerId:"alice",deploymentId:"wujie-v10-device-fixture",bundleId:"cn.qkxy.wujieai.public",deviceKeyHash:String(repeating:"a",count:64),launchNonce:launch,keys:["fixture":Data(base64Encoded:input["publicKey"] as! String)!],now:{time})
  }
  func expectFailure(_ label:String,_ body:() throws->Void) throws {
   do{try body();throw NSError(domain:"unexpected_acceptance_"+label,code:1)}catch let error as NSError{if error.domain.hasPrefix("unexpected_acceptance_"){throw error};passed.append(label)}
  }
  let valid=input["valid"] as! String,g=try guardInstance();_=try g.request(nonce:String(repeating:"1",count:64),operation:"acquire")
  time=105;try g.accept(valid);assert(g.snapshot()["remainingMs"] as! Int==1795000);passed.append("cross_language_signature")
  time=130;try g.accept(valid);assert(g.snapshot()["remainingMs"] as! Int==1770000);passed.append("duplicate_does_not_reset_clock")
  try g.requireValid(component:"asr",language:"zh");try g.requireValid(component:"translation",language:"zh",target:"en")
  try expectFailure("unqualified_language"){try g.requireValid(component:"asr",language:"auto")}
  for language in ["zh-Hant","zh-TW","zh-HK","yue","zh-Hans-HK"] {
    try expectFailure("unqualified_variant_\(language)"){try g.requireValid(component:"asr",language:language)}
  }
  time=100;let versionMismatch=try guardInstance();_=try versionMismatch.request(nonce:String(repeating:"1",count:64),operation:"acquire")
  try expectFailure("v1_request_rejects_v2"){try versionMismatch.accept(input["validV2"] as! String)}
  let v2=try guardInstance();_=try v2.request(nonce:String(repeating:"1",count:64),operation:"acquire",profile:V10DeviceLicenseGuard.profileV2,implementationHash:V10DeviceLicenseGuard.implementationHashV2)
  try v2.accept(input["validV2"] as! String);try v2.requireValid(component:"translation",language:"zh",target:"en");passed.append("v2_contract_accepted")
  let widened=try guardInstance();_=try widened.request(nonce:String(repeating:"1",count:64),operation:"acquire",profile:V10DeviceLicenseGuard.profileV2,implementationHash:V10DeviceLicenseGuard.implementationHashV2)
  try expectFailure("v2_unqualified_widening"){try widened.accept(input["widenedV2"] as! String)}
  time=130
  try expectFailure("wrong_component"){try g.requireValid(component:"cloud_model")}
  try g.activity("asr",active:true);time=140;try g.activity("tts",active:true);time=150;try g.activity("asr",active:false);time=160;try g.activity("tts",active:false)
  assert(g.snapshot()["activeMs"] as! Int==30000);passed.append("parallel_activity_union_no_duplicate_charge")
  for item in input["rejects"] as! [[String:String]] {
   time=100;let isolated=try guardInstance();_=try isolated.request(nonce:String(repeating:"1",count:64),operation:"acquire")
   try expectFailure("reject_"+item["name"]!){try isolated.accept(item["token"]!)}
  }
  time=100;let fresh=try guardInstance(UUID().uuidString);_=try fresh.request(nonce:String(repeating:"1",count:64),operation:"acquire")
  try expectFailure("process_restart_rejects_old_license"){try fresh.accept(valid)}
  time=100;let late=try guardInstance();_=try late.request(nonce:String(repeating:"1",count:64),operation:"acquire");time=1900
  try expectFailure("late_response_at_exact_cutoff"){try late.accept(valid)}
  time=100;let rollback=try guardInstance();_=try rollback.request(nonce:String(repeating:"1",count:64),operation:"acquire");try rollback.accept(valid);time=99
  try expectFailure("monotonic_rollback_fails_closed"){try rollback.requireValid(component:"asr")}
  time=100;let delayedRenewal=try guardInstance();_=try delayedRenewal.request(nonce:String(repeating:"1",count:64),operation:"acquire");try delayedRenewal.accept(valid)
  time=1840;_=try delayedRenewal.request(nonce:String(repeating:"2",count:64),operation:"renew")
  time=1900;delayedRenewal.invalidate("expired",preservePending:true)
  try expectFailure("expired_old_license_stops_during_unknown_renewal"){try delayedRenewal.requireValid(component:"asr")}
  time=1910;try delayedRenewal.accept(input["renewal"] as! String)
  assert(delayedRenewal.snapshot()["remainingMs"] as! Int==1730000);passed.append("late_renewal_keeps_original_request_anchor")
  time=1840;_=try g.request(nonce:String(repeating:"2",count:64),operation:"renew");time=1841;try g.accept(input["renewal"] as! String)
  assert(g.snapshot()["sequence"] as! Int==2);passed.append("renewal_replaces_sequence")
  time=3640;try expectFailure("hard_cutoff_for_all_components"){
   try g.requireValid(component:"asr")
  }
  for component in ["translation","tts","ocr"] {try expectFailure("expired_"+component){try g.requireValid(component:component)}}
  let result:[String:Any]=["passed":passed.count,"failed":0,"cases":passed,"modelCalls":0,"deviceAccess":false]
  print(String(data:try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
 }
}
