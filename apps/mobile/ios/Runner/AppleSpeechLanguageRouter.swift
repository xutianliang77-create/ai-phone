import Foundation

/// Pure routing policy; confidence is engine evidence, not a quality guarantee.
/// Production qualification still requires real bilingual/number/negation audio.
struct AppleSpeechLanguageCandidate {
  let key: Int, language: String, start: Int, end: Int, text: String
  let confidence: Double?
  let final: Bool
}
struct AppleSpeechLanguageDecision {
  let turn: Int, start: Int, end: Int, language: String?, text: String?
  let confidence: Double?, reason: String
}
enum AppleSpeechRoutingError: Error { case invalidEvidence, bufferOverflow }

/// Both decoders consume the same original capture. Commit only a finalized,
/// VAD-bounded turn with corroborating script and a clear confidence margin.
/// Missing evidence never silently selects the last or UI-selected language.
struct AppleSpeechLanguageRouter {
  static let version = "apple-dual-zh-en-confidence-r1"
  static let languages = ["zh", "en"]
  static let minimumConfidence = 0.72
  static let minimumMargin = 0.12
  let languages: [String]
  init(languages: [String] = Self.languages) { self.languages = languages }
  private var validPair: Bool { languages.count == 2 && Set(languages) == Set(Self.languages) }
  private struct Turn { let id: Int, start: Int, end: Int, deadline: Double }
  private var turns = [Turn]()
  private var fragments = [String:[Int:AppleSpeechLanguageCandidate]]()
  private var finalized = [String:Int]()
  private var serial = 0
  private(set) var completedThrough = 0
  var pendingTurnCount: Int { turns.count }
  var diagnostics: [String:Any] {
    ["policy":Self.version,"requiredLanguages":languages,"finalizedThrough":finalized,
      "pendingTurns":turns.count,"heldFragments":fragments.values.reduce(0,{$0+$1.count}),
      "minimumConfidence":Self.minimumConfidence,"minimumMargin":Self.minimumMargin,"qualityQualified":false]
  }
  mutating func observeFinalization(language:String,through:Int) throws {
    guard validPair,languages.contains(language),through>=0 else{throw AppleSpeechRoutingError.invalidEvidence}
    finalized[language]=max(finalized[language] ?? 0,through)
  }

  mutating func accept(_ c: AppleSpeechLanguageCandidate, finalizedThrough: Int) throws {
    guard validPair,languages.contains(c.language), c.start >= 0, c.end >= c.start,
      c.text.utf8.count <= 16384, finalizedThrough >= 0,
      c.confidence == nil || (c.confidence!.isFinite && (0...1).contains(c.confidence!)) else {
      throw AppleSpeechRoutingError.invalidEvidence
    }
    try observeFinalization(language:c.language,through:finalizedThrough)
    if c.end <= completedThrough { return }
    if c.text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
      fragments[c.language,default:[:]].removeValue(forKey:c.key)
    } else { fragments[c.language,default:[:]][c.key] = c }
    guard fragments.values.reduce(0,{$0+$1.count}) <= 512,
      fragments.values.flatMap({$0.values}).reduce(0,{$0+$1.text.utf8.count}) <= 65536 else {
      throw AppleSpeechRoutingError.bufferOverflow
    }
  }
  mutating func endTurn(start:Int,end:Int,now:Double) throws {
    guard validPair,now.isFinite, start >= completedThrough, end > start,
      turns.last.map({start >= $0.end}) ?? true else {throw AppleSpeechRoutingError.invalidEvidence}
    serial += 1
    turns.append(Turn(id:serial,start:start,end:end,deadline:now+2))
    guard turns.count <= 16 else {throw AppleSpeechRoutingError.bufferOverflow}
  }
  mutating func drain(now:Double) throws -> [AppleSpeechLanguageDecision] {
    guard validPair,now.isFinite else {throw AppleSpeechRoutingError.invalidEvidence}
    var decisions = [AppleSpeechLanguageDecision]()
    while let turn=turns.first {
      let complete=languages.allSatisfy{(finalized[$0] ?? 0) >= turn.end}
      if !complete && now < turn.deadline {break}
      let values=languages.compactMap{aggregate(language:$0,turn:turn)}
      let ranked=values.sorted{$0.confidence > $1.confidence}
      let winner=ranked.first
      let confident=complete && ranked.count==2 && winner!.confidence >= Self.minimumConfidence &&
        winner!.confidence-ranked[1].confidence >= Self.minimumMargin && winner!.plausible
      decisions.append(AppleSpeechLanguageDecision(turn:turn.id,start:turn.start,end:turn.end,
        language:confident ? winner!.language:nil,text:confident ? winner!.text:nil,
        confidence:confident ? winner!.confidence:nil,
        reason:confident ? "dual_decoder_confidence":complete ? "automatic_language_uncertain":"automatic_language_evidence_timeout"))
      turns.removeFirst();completedThrough=turn.end
      for language in languages {
        fragments[language] = fragments[language,default:[:]].filter{$0.value.end > turn.end}
      }
    }
    return decisions
  }
  private struct Aggregate {let language:String,text:String,confidence:Double,plausible:Bool}
  private func aggregate(language:String,turn:Turn) -> Aggregate? {
    let selected=fragments[language,default:[:]].values.filter {
      $0.final && $0.end > turn.start && $0.start < turn.end &&
      ($0.start+($0.end-$0.start)/2)>=turn.start && ($0.start+($0.end-$0.start)/2)<turn.end &&
      // An unsplit hypothesis crossing the next turn cannot be duplicated.
      $0.end <= turn.end+4096 && $0.start >= max(0,turn.start-4096)
    }.sorted{$0.start==$1.start ? $0.key<$1.key:$0.start<$1.start}
    guard !selected.isEmpty,selected.allSatisfy({$0.confidence != nil}) else{return nil}
    var intervals=[Range<Int>](),weighted=0.0,weight=0
    for c in selected {
      let start=max(turn.start,c.start),end=min(turn.end,c.end)
      guard end>start else{continue}
      intervals.append(start..<end);weighted+=c.confidence!*Double(end-start);weight+=end-start
    }
    var covered=0,last=turn.start
    for interval in intervals.sorted(by:{$0.lowerBound<$1.lowerBound}) {
      covered+=max(0,interval.upperBound-max(last,interval.lowerBound));last=max(last,interval.upperBound)
    }
    guard weight>0,Double(covered)/Double(turn.end-turn.start)>=0.55 else{return nil}
    let text=selected.map{$0.text.trimmingCharacters(in:.whitespacesAndNewlines)}.joined(separator:language=="zh" ? "":" ")
    let scalars=text.unicodeScalars
    let han=scalars.filter{(0x3400...0x9fff).contains(Int($0.value))}.count
    let latin=scalars.filter{(65...90).contains(Int($0.value)) || (97...122).contains(Int($0.value))}.count
    // Script is only a rejection check. A transcript's script cannot establish
    // the spoken language by itself, including digit-only ambiguous turns.
    return Aggregate(language:language,text:text,confidence:weighted/Double(weight),
      plausible:language=="zh" ? han>0:latin>0 && han==0)
  }
}
