import {afterEach,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {realtimeLogger} from "./realtime-metrics.js";
import {logPublicAsrBoundary,publicAsrBoundaryTracePayload,logPublicSessionEnd,publicSessionEndTracePayload,publicPcm16Level,publicAsrAssemblyTracePayload,logPublicAsrAssembly} from "./public-asr-boundary-trace.js";

afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});

it("records bounded numeric PCM levels without treating a nonzero sample as speech",()=>{
  expect(publicPcm16Level(Buffer.from([0,0,3,0,252,255]))).toEqual({sampleCount:3,zeroSamples:1,peakAbs:4,rms:2.887});
  expect(publicPcm16Level(Buffer.alloc(8))).toEqual({sampleCount:4,zeroSamples:4,peakAbs:0,rms:0});
  expect(publicPcm16Level(Buffer.alloc(0))).toBeUndefined();expect(publicPcm16Level(Buffer.alloc(1))).toBeUndefined();
});

it("does not inspect or log PCM without both QA gates and never logs its bytes",()=>{
  const info=vi.spyOn(realtimeLogger,"info").mockImplementation(()=>{}),pcm=Buffer.from([3,0,252,255]);
  const sample=vi.spyOn(pcm,"readInt16LE");
  vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED",undefined);vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED",undefined);
  const value={sessionId:"session",stage:"accepted" as const,sequence:1,startSample:0,endSample:2};
  logPublicAsrBoundary(value,pcm);expect(sample).not.toHaveBeenCalled();expect(info).not.toHaveBeenCalled();
  vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED","true");vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED","true");
  logPublicAsrBoundary(value,pcm);
  expect(info.mock.calls[0]![0]).toEqual({...value,audioLevel:{sampleCount:2,zeroSamples:0,peakAbs:4,rms:3.536}});
  expect(info.mock.calls[0]![0]).not.toHaveProperty("pcm");expect(info.mock.calls[0]![0]).not.toHaveProperty("data");
});

it("does not let boundary diagnostic I/O fail accepted-audio or provider transport",()=>{
  vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED","true");vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED","true");
  vi.spyOn(realtimeLogger,"info").mockImplementation(()=>{throw Error("synthetic_log_failure");});
  expect(()=>logPublicAsrBoundary({sessionId:"session",stage:"accepted",startSample:0,endSample:2},Buffer.alloc(4))).not.toThrow();
  expect(()=>logPublicAsrBoundary({sessionId:"session",stage:"provider_audio",startSample:0,endSample:2},Buffer.alloc(4))).not.toThrow();
});

it("records assembly identity and numeric timing without source or translated text",()=>{
  const input={segmentId:"new-part",text:"DO_NOT_LOG",revision:1,apiKey:"DO_NOT_LOG"};
  const merged={segmentId:"first-part",text:"DO_NOT_LOG_LONGER",language:"en" as const,revision:1,
    timing:{startMs:0,endMs:750,source:"estimated" as const}};
  const payload=publicAsrAssemblyTracePayload("session","push",{ready:[merged],supersededSegmentIds:["new-part"]},input);
  expect(payload).toMatchObject({sessionId:"session",stage:"assembly",trigger:"push",inputSegmentId:"new-part",readyCount:1,
    ready:[{segmentId:"first-part",startMs:0,endMs:750}],supersededSegmentIds:["new-part"]});
  expect(JSON.stringify(payload)).not.toContain("DO_NOT_LOG");
});

it("distinguishes held content and timeout release and bounds only the logged arrays",()=>{
  const partial={segmentId:"held-part",text:"this is",language:"en" as const};
  expect(publicAsrAssemblyTracePayload("session","push",{ready:[],partial},partial)).toMatchObject({readyCount:0,held:{segmentId:"held-part"}});
  const ready=Array.from({length:20},(_,i)=>({...partial,segmentId:`part-${i}`}));
  const result={ready,supersededSegmentIds:ready.map(x=>x.segmentId)};
  const payload=publicAsrAssemblyTracePayload("session","timeout",result);
  expect(payload?.readyCount).toBe(20);expect(payload?.ready).toHaveLength(16);expect(payload?.supersededSegmentIds).toHaveLength(16);
  expect(result.ready).toHaveLength(20);
});

it("keeps assembly tracing gated and cannot fail a translation on logger error",()=>{
  const info=vi.spyOn(realtimeLogger,"info").mockImplementation(()=>{throw Error("synthetic_log_failure");});
  const result={ready:[{segmentId:"part",text:"private text",language:"en" as const}]};
  vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED",undefined);vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED",undefined);
  logPublicAsrAssembly("session","end",result);expect(info).not.toHaveBeenCalled();
  vi.stubEnv("PUBLIC_ASR_BOUNDARY_TRACE_ENABLED","true");vi.stubEnv("PUBLIC_QA_ONE_SHOT_ENABLED","true");
  expect(()=>logPublicAsrAssembly("session","end",result)).not.toThrow();expect(info).toHaveBeenCalledOnce();
});

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
