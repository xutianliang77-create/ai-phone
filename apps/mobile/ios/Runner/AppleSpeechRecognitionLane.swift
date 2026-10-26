import Foundation
import Speech
import CoreMedia

@available(iOS 26.0, *)
@MainActor
final class AppleSpeechRecognitionLane {
  let language: String
  let transcriber: SpeechTranscriber
  private var hypotheses = AppleSpeechHypothesisTracker()
  private var confidences = [Int:Double]()
  private var confidenceEnds = [Int:Int]()
  init(language:String,locale:Locale,automatic:Bool) {
    self.language=language
    transcriber=automatic ? SpeechTranscriber(locale:locale,transcriptionOptions:[],
      reportingOptions:[.volatileResults],attributeOptions:[.audioTimeRange,.transcriptionConfidence]) :
      SpeechTranscriber(locale:locale,preset:.timeIndexedProgressiveTranscription)
  }
  func accept(_ result:SpeechTranscriber.Result,fedSamples:Int) throws -> ([AppleSpeechLanguageCandidate],Int) {
    let start=CMTimeGetSeconds(result.range.start),end=CMTimeGetSeconds(result.range.end)
    guard start.isFinite,end.isFinite,start>=0,end>=start,end<=Double(fedSamples)/16000+0.1 else {
      throw AppleSpeechRoutingError.invalidEvidence
    }
    let mark=CMTimeGetSeconds(result.resultsFinalizationTime)
    let through=mark.isFinite && mark>=0 ? min(fedSamples,Int((mark*16000).rounded())):0
    let text=String(result.text.characters),confidence=Self.confidence(result.text)
    let updates=try hypotheses.accept(text:text,start:Int((start*16000).rounded()),end:Int((end*16000).rounded()),
      final:result.isFinal,finalizedThrough:through)
    let candidates=updates.map { h -> AppleSpeechLanguageCandidate in
      if h.retracted {confidences.removeValue(forKey:h.key);confidenceEnds.removeValue(forKey:h.key)}
      else if h.text==text {confidences[h.key]=confidence;confidenceEnds[h.key]=h.end}
      return AppleSpeechLanguageCandidate(key:h.key,language:language,start:h.start,end:h.end,
        text:h.text,confidence:confidences[h.key],final:h.final)
    }
    guard confidenceEnds.count<=512 else{throw AppleSpeechRoutingError.bufferOverflow}
    return (candidates,through)
  }
  func discard(through:Int) {
    // Confidence entries are metadata only. The router owns retained fragments;
    // old keys need not survive a turn's terminal decision.
    for (key,end) in confidenceEnds where end<=through {confidences.removeValue(forKey:key);confidenceEnds.removeValue(forKey:key)}
  }
  private static func confidence(_ text:AttributedString) -> Double? {
    var weight=0,value=0.0
    for run in text.runs {
      let count=text[run.range].characters.filter{!$0.isWhitespace}.count
      if count==0 {continue}
      guard let score=run[AttributeScopes.SpeechAttributes.ConfidenceAttribute.self],
        score.isFinite,(0...1).contains(score) else{return nil}
      value+=score*Double(count);weight+=count
    }
    return weight>0 ? value/Double(weight):nil
  }
}
