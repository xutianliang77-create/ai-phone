import { expect, it } from "vitest";
import { mergedLanguageEvidence } from "./segment-language-evidence.js";
import type { SpeechTranscript } from "./speech-transcript.js";
const part=(language:"en"|"zh",status?:SpeechTranscript["automaticLanguageStatus"]):SpeechTranscript=>({segmentId:"part",text:"text",language,...(status?{automaticLanguageStatus:status}:{})});
it("does not add evidence to legacy inputs",()=>{
  expect(mergedLanguageEvidence([part("en"),part("zh")])).toEqual({});
});
it("requires agreement from every merged input",()=>{
  expect(mergedLanguageEvidence([part("en","detected"),part("en","detected")])).toEqual({automaticLanguageStatus:"detected"});
  expect(mergedLanguageEvidence([part("en","detected"),part("zh","detected")])).toEqual({automaticLanguageStatus:"mixed"});
  expect(mergedLanguageEvidence([part("en","detected"),part("en")])).toEqual({automaticLanguageStatus:"unknown"});
  expect(mergedLanguageEvidence([part("en","unknown"),part("en","detected")])).toEqual({automaticLanguageStatus:"unknown"});
});
