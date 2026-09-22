import {afterEach,it,expect,vi} from "vitest";
import {sendStreamingAsrWireEvent,streamingAsrSendDiagnostic} from "./streaming-asr-wire-send.js";
import type {State} from "./streaming-asr-state.js";

function state(send: (body:string,callback:(error?:Error)=>void)=>void) {
  return {ws:{readyState:1,bufferedAmount:0,send},stop:new AbortController()} as unknown as State;
}
const frame={type:"input_audio_buffer.append",audio:Buffer.alloc(3200).toString("base64")};
afterEach(()=>vi.restoreAllMocks());

it("keeps the original envelope and does not create audio observations for control events",async()=>{
  const sent:string[]=[],s=state((body,callback)=>{sent.push(body);callback();});
  const control={type:"session.update",session:{input_audio_format:"pcm"}};
  await sendStreamingAsrWireEvent(s,control,true,16000);
  expect(JSON.parse(sent[0])).toMatchObject(control);
  expect(JSON.parse(sent[0]).event_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(control).not.toHaveProperty("event_id");expect(streamingAsrSendDiagnostic(s.audioSend)).toEqual({});
  await sendStreamingAsrWireEvent(s,control,false,24000);
  expect(JSON.parse(sent[1])).toEqual(control);
});
it("reports bounded local send cadence without retaining PCM or pretending it is supplier confirmation",async()=>{
  let now=100;vi.spyOn(performance,"now").mockImplementation(()=>now);
  const sent:string[]=[],s=state((body,callback)=>{sent.push(body);now+=10;callback();});
  await sendStreamingAsrWireEvent(s,frame,true,16000);now=300;
  await sendStreamingAsrWireEvent(s,frame,true,16000);
  expect(streamingAsrSendDiagnostic(s.audioSend,350)).toEqual({audioSend:{appendStarted:2,appendCompleted:2,appendFailed:0,
    lastAppendAgeMs:50,lastCompletedAgeMs:40,maxAppendGapMs:200,maxPacketAudioMs:100,pendingAudioMs:0}});
  expect(JSON.stringify(s.audioSend)).not.toContain(frame.audio);
  expect(sent).toHaveLength(2);expect(sent.map(v=>JSON.parse(v).audio)).toEqual([frame.audio,frame.audio]);
});
it("observes an in-flight write and preserves abort without retrying",async()=>{
  vi.spyOn(performance,"now").mockReturnValue(100);
  const send=vi.fn((_body:string,_callback:(error?:Error)=>void)=>{}),s=state(send);
  const pending=sendStreamingAsrWireEvent(s,frame,true,16000);
  expect(streamingAsrSendDiagnostic(s.audioSend,150)).toMatchObject({audioSend:{appendStarted:1,appendCompleted:0,pendingAudioMs:100}});
  s.stop.abort();await expect(pending).rejects.toThrow();expect(send).toHaveBeenCalledTimes(1);
  expect(streamingAsrSendDiagnostic(s.audioSend,160)).toMatchObject({audioSend:{appendFailed:1,appendCompleted:0,pendingAudioMs:0}});
});
it("preserves write failure and does not emit the underlying error body",async()=>{
  const send=vi.fn((_body:string,callback:(error?:Error)=>void)=>callback(Error("SECRET_ERROR_BODY"))),s=state(send);
  await expect(sendStreamingAsrWireEvent(s,frame,false,24000)).rejects.toThrow("send failed");
  expect(send).toHaveBeenCalledTimes(1);expect(s.audioSend?.failed).toBe(1);
  expect(JSON.stringify(streamingAsrSendDiagnostic(s.audioSend))).not.toContain("SECRET");
});
it("retains the ready-state and buffered-byte guards before any write",async()=>{
  for(const [readyState,bufferedAmount] of [[3,0],[1,1048577]]){
    const send=vi.fn(),s=state(send);Object.assign(s.ws!,{readyState,bufferedAmount});
    await expect(sendStreamingAsrWireEvent(s,frame,true,16000)).rejects.toThrow("socket not writable");
    expect(send).not.toHaveBeenCalled();expect(s.audioSend).toBeUndefined();
  }
});
it("drops invalid diagnostic values rather than serializing arbitrary state",()=>{
  expect(streamingAsrSendDiagnostic({started:'SECRET',completed:NaN,failed:-1,lastStartedAt:Infinity,
    maxGapMs:-2,maxPacketMs:Infinity,pendingMs:'SECRET'} as any,100)).toEqual({audioSend:{}});
});
