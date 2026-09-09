import {expect,it} from "vitest";
import {modelAttemptKey,type PublicModelAttemptEvent} from "./model-attempt.js";
const event:PublicModelAttemptEvent={sessionId:"s",leaseId:"l",attemptId:"a",segmentId:"seg",revision:1,component:"tts",providerId:"qwen",modelId:"manual",state:"confirmed"};
it.each(["billedCharacters","audioOutputTokens"] as const)("includes %s in exact attempt ACK identity",field=>{
  expect(modelAttemptKey({...event,metadata:{usage:{[field]:3}}})).not.toBe(modelAttemptKey({...event,metadata:{usage:{[field]:4}}}));
  expect(modelAttemptKey({...event,metadata:{usage:{[field]:0}}})).not.toBe(modelAttemptKey(event));
});
