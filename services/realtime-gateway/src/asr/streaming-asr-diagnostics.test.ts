import {it,expect} from "vitest";
import {streamingAsrFailureDiagnostic} from "./streaming-asr-diagnostics.js";
it("exposes only bounded error codes, known event types and numeric watermarks",()=>{
  expect(streamingAsrFailureDiagnostic("qwen_asr_language_mismatch","conversation.item.input_audio_transcription.text",1600))
    .toEqual({code:"qwen_asr_language_mismatch",eventType:"conversation.item.input_audio_transcription.text",uploadedSamples:1600});
  expect(JSON.stringify(streamingAsrFailureDiagnostic("SECRET text","SECRET credentials",NaN))).not.toContain("SECRET");
  expect(streamingAsrFailureDiagnostic("bad",{audio:"SECRET",transcript:"SECRET"},-1))
    .toEqual({code:"bad",eventType:"unknown",uploadedSamples:0});
  expect(streamingAsrFailureDiagnostic("bad","conversation.item.input_audio_transcription.text",1600,"ja").language).toBe("ja");
  expect(JSON.stringify(streamingAsrFailureDiagnostic("bad","error",0,"SECRET_LANGUAGE_BODY"))).not.toContain("SECRET");
});
