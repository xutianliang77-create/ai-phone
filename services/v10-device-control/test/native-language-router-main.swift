import Foundation

@main struct LanguageRouterTests {
  static func main() throws {
    var passed=[String]()
    func candidate(_ language:String,_ text:String,_ confidence:Double?,key:Int=1,start:Int=0,end:Int=16000,final:Bool=true)->AppleSpeechLanguageCandidate {
      AppleSpeechLanguageCandidate(key:key,language:language,start:start,end:end,text:text,confidence:confidence,final:final)
    }
    func pair(_ zh:Double?,_ en:Double?,zhText:String="不是取消订单，而是明天发货",enText:String="Do not cancel order A120",final:Bool=true)->AppleSpeechLanguageRouter {
      var r=AppleSpeechLanguageRouter()
      try! r.accept(candidate("zh",zhText,zh,final:final),finalizedThrough:16000)
      try! r.accept(candidate("en",enText,en,final:final),finalizedThrough:16000)
      return r
    }
    func check(_ name:String,_ condition:Bool) throws {guard condition else{throw NSError(domain:"router_assert_"+name,code:1)};passed.append(name)}
    func expectFailure(_ name:String,_ action:() throws->Void) throws {
      do{try action();throw NSError(domain:"unexpected_accept_"+name,code:1)}catch let e as NSError{if e.domain.hasPrefix("unexpected_accept_"){throw e};passed.append(name)}
    }
    var zh=pair(0.95,0.5);try zh.endTurn(start:0,end:16000,now:0);let z=try zh.drain(now:0).first!
    try check("clear_chinese",z.language=="zh" && z.text=="不是取消订单，而是明天发货")
    var en=pair(0.4,0.92);try en.endTurn(start:0,end:16000,now:0);let e=try en.drain(now:0).first!
    try check("clear_english_preserves_negation_and_id",e.language=="en" && e.text=="Do not cancel order A120")
    try check("model_sample_timeline",e.start==0 && e.end==16000)
    var reversed=AppleSpeechLanguageRouter(languages:["en","zh"])
    try reversed.accept(candidate("zh","请明天发货",0.95),finalizedThrough:16000)
    try reversed.accept(candidate("en","tomorrow",0.4),finalizedThrough:16000)
    try reversed.endTurn(start:0,end:16000,now:0)
    try check("selected_pair_reverse_order",try reversed.drain(now:0).first?.language=="zh")
    try expectFailure("duplicate_pair_rejected"){var r=AppleSpeechLanguageRouter(languages:["zh","zh"]);try r.endTurn(start:0,end:16000,now:0)}
    try expectFailure("unqualified_pair_rejected"){var r=AppleSpeechLanguageRouter(languages:["zh","fr"]);try r.endTurn(start:0,end:16000,now:0)}
    var tied=pair(0.90,0.85);try tied.endTurn(start:0,end:16000,now:0)
    try check("close_scores_do_not_guess",try tied.drain(now:0).first?.language==nil)
    var low=pair(0.5,0.7);try low.endTurn(start:0,end:16000,now:0)
    try check("low_confidence_do_not_guess",try low.drain(now:0).first?.language==nil)
    var missing=pair(nil,0.99);try missing.endTurn(start:0,end:16000,now:0)
    try check("missing_lane_confidence_rejects",try missing.drain(now:0).first?.language==nil)
    var wrong=pair(0.99,0.5,zhText:"high confidence in wrong script");try wrong.endTurn(start:0,end:16000,now:0)
    try check("transcript_script_is_rejection_not_language_proof",try wrong.drain(now:0).first?.language==nil)
    var digits=pair(0.99,0.8,zhText:"947",enText:"947");try digits.endTurn(start:0,end:16000,now:0)
    try check("ambiguous_digits_do_not_invent_language",try digits.drain(now:0).first?.language==nil)
    var partial=pair(0.95,0.5,final:false);try partial.endTurn(start:0,end:16000,now:0)
    try check("volatile_results_never_commit",try partial.drain(now:0).first?.language==nil)
    var noVad=pair(0.95,0.5)
    try check("ASR_output_without_VAD_turn_never_commits",try noVad.drain(now:5).isEmpty)
    var waiting=AppleSpeechLanguageRouter();try waiting.accept(candidate("en","do not cancel",0.95),finalizedThrough:16000);try waiting.endTurn(start:0,end:16000,now:0)
    try check("wait_for_both_actual_finalization_watermarks",try waiting.drain(now:1.9).isEmpty)
    try check("missing_lane_has_bounded_deadline",try waiting.drain(now:2).first?.reason=="automatic_language_evidence_timeout")
    var retract=pair(0.95,0.5);try retract.accept(candidate("zh","",nil),finalizedThrough:16000);try retract.endTurn(start:0,end:16000,now:0)
    try check("retraction_removes_old_candidate",try retract.drain(now:0).first?.language==nil)
    var short=AppleSpeechLanguageRouter();try short.accept(candidate("zh","不要取消",0.95,end:1000),finalizedThrough:16000);try short.accept(candidate("en","cancel",0.4,end:1000),finalizedThrough:16000);try short.endTurn(start:0,end:16000,now:0)
    try check("insufficient_audio_coverage_rejects",try short.drain(now:0).first?.language==nil)
    var repeated=pair(0.95,0.5);try repeated.endTurn(start:0,end:16000,now:0);let first=try repeated.drain(now:0).first!
    try repeated.accept(candidate("zh","不是取消订单，而是明天发货",0.95,key:2,start:16000,end:32000),finalizedThrough:32000)
    try repeated.accept(candidate("en","Do not cancel order A120",0.4,key:2,start:16000,end:32000),finalizedThrough:32000)
    try repeated.endTurn(start:16000,end:32000,now:1);let second=try repeated.drain(now:1).first!
    try check("real_repeated_phrase_has_distinct_turn_identity",first.turn != second.turn && first.text==second.text)
    try repeated.accept(candidate("zh","迟到的旧结果",1),finalizedThrough:32000)
    try check("late_old_result_cannot_reopen_completed_turn",try repeated.drain(now:3).isEmpty)
    try expectFailure("unsupported_language_rejected"){var r=AppleSpeechLanguageRouter();try r.accept(candidate("fr","non",0.95),finalizedThrough:1)}
    try expectFailure("nan_confidence_rejected"){var r=AppleSpeechLanguageRouter();try r.accept(candidate("en","no",.nan),finalizedThrough:1)}
    try expectFailure("invalid_range_rejected"){var r=AppleSpeechLanguageRouter();try r.accept(candidate("en","no",0.9,start:2,end:1),finalizedThrough:1)}
    try expectFailure("overlapping_turns_rejected"){var r=AppleSpeechLanguageRouter();try r.endTurn(start:0,end:16000,now:0);try r.endTurn(start:10,end:17000,now:1)}
    try expectFailure("bounded_pending_turns"){var r=AppleSpeechLanguageRouter();for i in 0..<17{try r.endTurn(start:i*16000,end:(i+1)*16000,now:0)}}
    try expectFailure("bounded_fragment_store"){var r=AppleSpeechLanguageRouter();for i in 0..<513{try r.accept(candidate("en","word",0.9,key:i,start:i*10,end:i*10+10),finalizedThrough:0)}}
    print(String(data:try JSONSerialization.data(withJSONObject:["passed":passed.count,"failed":0,"cases":passed,"realModelCalls":0,"qualityQualified":false],options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
  }
}
