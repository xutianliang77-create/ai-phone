import Foundation

@main struct VoicePolicyTests {
  static func main() throws {
    var count=0
    func check(_ condition: Bool,_ name: String) throws {
      guard condition else { throw NSError(domain:"voice_policy_"+name,code:1) }
      count += 1
    }
    func voice(_ id:String,_ lang:String,personal:Bool=false,novelty:Bool=false,quality:Int=1) -> SystemSpeechVoiceDescriptor {
      .init(identifier:id,name:"fixture",language:lang,quality:quality,personal:personal,novelty:novelty)
    }
    let cn=voice("com.apple.voice.cn","zh-CN"),en=voice("com.apple.voice.en","en-US")
    try check(SystemSpeechVoicePolicy.eligible(cn,language:"zh"),"chinese")
    try check(SystemSpeechVoicePolicy.eligible(en,language:"en"),"english")
    try check(!SystemSpeechVoicePolicy.eligible(cn,language:"en"),"cross_language")
    try check(!SystemSpeechVoicePolicy.eligible(voice("com.apple.voice.tw","zh-TW"),language:"zh"),"traditional_not_simplified")
    try check(!SystemSpeechVoicePolicy.eligible(voice("com.apple.voice.hk","zh-HK"),language:"yue"),"ambiguous_hong_kong")
    try check(!SystemSpeechVoicePolicy.eligible(voice("com.apple.voice.personal","en-US",personal:true),language:"en"),"personal_blocked")
    try check(!SystemSpeechVoicePolicy.eligible(voice("com.apple.voice.novelty","en-US",novelty:true),language:"en"),"novelty_blocked")
    try check(!SystemSpeechVoicePolicy.eligible(voice("third.party.voice","en-US"),language:"en"),"third_party_blocked")
    let higher=voice("com.apple.voice.en2","en-US",quality:2)
    let sorted=SystemSpeechVoicePolicy.candidates([higher,en,cn],language:"en",preferredIdentifier:en.identifier)
    try check(sorted.map(\.identifier)==[en.identifier,higher.identifier],"preference_order_and_filter")
    let report:[String:Any]=["passed":count,"failed":0,"deviceAccess":false,"realVoicesUsed":false]
    print(String(data:try JSONSerialization.data(withJSONObject:report,options:.sortedKeys),encoding:.utf8)!)
  }
}
