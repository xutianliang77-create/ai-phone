import {afterEach,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {realtimeLogger} from "./realtime-metrics.js";
import {logPublicAsrBoundary,publicAsrBoundaryTracePayload,logPublicSessionEnd,publicSessionEndTracePayload} from "./public-asr-boundary-trace.js";

afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

it("retains only non-content Qwen boundary fields and hashes the supplier item",()=>{
  const input={sessionId:"session",stage:"completed" as const,itemId:"supplier-item-private",segmentId:"segment",
    sequence:7,startSample:1600,endSample:3200,acceptedSamples:4800,textCharCount:12,language:"en",
    transcript:"DO_NOT_LOG",apiKey:"DO_NOT_LOG"};
  const payload=publicAsrBoundaryTracePayload(input);
  expect(payload).toEqual({sessionId:"session",stage:"completed",
    itemHash:createHash("sha256").update(input.itemId).digest("hex").slice(0,12),segmentId:"segment",sequence:7,
    startSample:1600,endSample:3200,acceptedSamples:4800,textCharCount:12,language:"en"});
  expect(JSON.stringify(payload)).not.toContain("DO_NOT_LOG");
  expect(JSON.stringify(payload)).not.toContain(input.itemId);
});

it("emits nothing unless both explicit QA trace and one-shot gates are enabled",()=>{
  const info=vi.spyOn(realtimeLogger,"info").mockImplementation(()=>{});
  const value={sessionId:"session",stage:"provider_audio" as const,startSample:0,endSample:1600};
  logPublicAsrBoundary(value);expect(info).not.toHaveBeenCalled();
  vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED","true");logPublicAsrBoundary(value);expect(info).not.toHaveBeenCalled();
  vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED","true");logPublicAsrBoundary(value);
  expect(info).toHaveBeenCalledOnce();expect(info.mock.calls[0]![0]).toMatchObject({stage:"provider_audio",startSample:0,endSample:1600});
});

it("retains only the allowlisted lifecycle reason, without user content or close-message text",()=>{
  const input={sessionId:"public-session",reason:"client_request" as const,stage:"requested" as const,
    transcript:"DO_NOT_LOG",closeMessage:"DO_NOT_LOG",apiKey:"DO_NOT_LOG"};
  expect(publicSessionEndTracePayload(input)).toEqual({sessionId:"public-session",reason:"client_request",stage:"requested"});
  expect(publicSessionEndTracePayload({...input,reason:"DO_NOT_LOG" as never})).toBeUndefined();
  expect(publicSessionEndTracePayload({...input,stage:"DO_NOT_LOG" as never})).toBeUndefined();
});

it("gates lifecycle metadata and never lets a logger failure block shutdown",()=>{
  const info=vi.spyOn(realtimeLogger,"info").mockImplementation(()=>{throw Error("synthetic_log_failure");});
  const event={sessionId:"public-session",reason:"connection_closed" as const,stage:"requested" as const};
  vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED",undefined);
  vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED",undefined);
  logPublicSessionEnd(event);expect(info).not.toHaveBeenCalled();
  vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED","true");
  logPublicSessionEnd(event);expect(info).not.toHaveBeenCalled();
  vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED","true");
  expect(()=>logPublicSessionEnd(event)).not.toThrow();expect(info).toHaveBeenCalledOnce();
});
