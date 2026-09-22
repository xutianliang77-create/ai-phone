import {it,expect} from "vitest";
import {streamingAsrFailureDiagnostic,streamingAsrCloseContext,streamingAsrProviderContext,streamingAsrTransportContext,
  streamingAsrCancellationContext,explicitAsrCloseReason,isStreamingAsrFailureEvent,streamingAsrProtocolContext} from "./streaming-asr-diagnostics.js";
it("classifies missing/invalid language and empty text without storing user payload",()=>{
  for(const [language,label] of [[undefined,"missing"],[null,"null"],["en","code"],["SECRET_LANGUAGE","other_string"],[{key:"SECRET_KEY"},"non_string"]]){
    const event={type:"conversation.item.input_audio_transcription.completed",language,transcript:"SECRET_USER_TEXT"};
    const value=streamingAsrFailureDiagnostic("qwen_asr_language_invalid",event.type,1600,language,streamingAsrProtocolContext(event));
    expect(value).toMatchObject({languageValueClass:label,transcriptEmpty:false});
    expect(JSON.stringify(value)).not.toContain("SECRET");
  }
  expect(streamingAsrProtocolContext({type:"conversation.item.input_audio_transcription.completed",transcript:"  "})).toMatchObject({transcriptEmpty:true});
});
it("exposes only bounded error codes, known event types and numeric watermarks",()=>{
  expect(streamingAsrFailureDiagnostic("qwen_asr_language_mismatch","conversation.item.input_audio_transcription.text",1600))
    .toEqual({code:"qwen_asr_language_mismatch",eventType:"conversation.item.input_audio_transcription.text",uploadedSamples:1600});
  expect(JSON.stringify(streamingAsrFailureDiagnostic("SECRET text","SECRET credentials",NaN))).not.toContain("SECRET");
  expect(streamingAsrFailureDiagnostic("bad",{audio:"SECRET",transcript:"SECRET"},-1))
    .toEqual({code:"bad",eventType:"unknown",uploadedSamples:0});
  expect(streamingAsrFailureDiagnostic("bad","conversation.item.input_audio_transcription.text",1600,"ja").language).toBe("ja");
  expect(JSON.stringify(streamingAsrFailureDiagnostic("bad","error",0,"SECRET_LANGUAGE_BODY"))).not.toContain("SECRET");
});

it("retains only safe close codes and known reason categories",()=>{
  expect(streamingAsrFailureDiagnostic("closed","session.updated",12,undefined,
    streamingAsrCloseContext(1007,Buffer.from("Model not found"))))
    .toMatchObject({origin:"transport_close",closeCode:1007,closeReason:"model_not_found",closeReasonBytes:15});
  for(const code of [-1,999,1016,2999,5000,NaN,"1011"]){
    expect(streamingAsrFailureDiagnostic("closed","session.updated",12,undefined,streamingAsrCloseContext(code,undefined))).not.toHaveProperty("closeCode");
  }
  for(const reason of ["SECRET_reason",Buffer.from("SECRET_KEY"),Buffer.alloc(200,65),{message:"SECRET_OBJECT"}]){
    const d=streamingAsrFailureDiagnostic("closed","session.updated",12,undefined,streamingAsrCloseContext(1006,reason));
    expect(d.closeReason).toBe("unrecognized");expect(JSON.stringify(d)).not.toContain("SECRET");
  }
});
it("retains only allowlisted reason signals, never unknown close prose",()=>{
  const reason="internal audio error: SECRET_IDENTIFIER";
  const value=streamingAsrFailureDiagnostic("closed","session.updated",1600,undefined,streamingAsrCloseContext(1011,reason));
  expect(value).toMatchObject({closeReason:"unrecognized",closeReasonSignals:["internal","audio"]});
  expect(JSON.stringify(value)).not.toContain("SECRET");expect(JSON.stringify(value)).not.toContain(reason);
  const context={origin:"transport_close" as const,closeReasonSignals:["quota","SECRET","quota",{key:"SECRET"},8]};
  expect(streamingAsrFailureDiagnostic("closed","error",0,undefined,context).closeReasonSignals).toEqual(["quota"]);
  expect(streamingAsrCloseContext(1011,Buffer.alloc(200,65))).not.toHaveProperty("closeReasonSignals");
});

it("allowlists provider fields even when malicious values look like identifiers",()=>{
  const known=streamingAsrFailureDiagnostic("failed","error",0,undefined,
    streamingAsrProviderContext({type:"error",error:{code:"invalid_value",type:"invalid_request_error",message:"SECRET_BODY",param:"SECRET_PARAM"}}));
  expect(known).toMatchObject({origin:"provider_error",providerErrorCode:"invalid_value",providerErrorType:"invalid_request_error"});
  expect(JSON.stringify(known)).not.toContain("SECRET");
  expect(known.providerErrorParam).toBe("unrecognized");
  expect(streamingAsrFailureDiagnostic("failed","error",0,undefined,
    streamingAsrProviderContext({error:{code:"invalid_value",param:"session.sample_rate"}})).providerErrorParam).toBe("session.sample_rate");
  for(const error of [null,[],{code:"SECRET_IDENTIFIER",type:"SECRET_TYPE"},{code:"sk-SECRET",message:"SECRET_BODY"}]){
    const d=streamingAsrFailureDiagnostic("failed","error",0,undefined,streamingAsrProviderContext({type:"error",error}));
    expect(d.providerErrorCode).toBe("unrecognized");expect(JSON.stringify(d)).not.toContain("SECRET");
  }
});

it("never serializes transport error messages, stacks or arbitrary abort reasons",()=>{
  for(const code of ["ECONNRESET","SECRET_KEY"]){
    const d=streamingAsrFailureDiagnostic("failed","session.updated",0,undefined,
      streamingAsrTransportContext(Object.assign(new Error("SECRET_MESSAGE"),{code})));
    expect(d.transportErrorCode).toBe(code==="ECONNRESET"?code:"unrecognized");expect(JSON.stringify(d)).not.toContain("SECRET");
  }
  const local=new AbortController();local.abort(explicitAsrCloseReason);
  expect(streamingAsrCancellationContext(local.signal)).toEqual({origin:"explicit_close"});
  const caller=new AbortController();caller.abort({apiKey:"SECRET_KEY"});
  expect(streamingAsrCancellationContext(caller.signal)).toEqual({origin:"caller_abort"});
  expect(isStreamingAsrFailureEvent({type:"conversation.item.input_audio_transcription.failed"})).toBe(true);
  for(const value of [null,[],"error",{type:"session.updated"}])expect(isStreamingAsrFailureEvent(value)).toBe(false);
});
