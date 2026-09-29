import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {deviceSpeakerProfile,type DeviceSpeakerEvidenceEvent} from '@translation/contracts';
import {attributeSpeakerTranscripts} from './speaker-transcript-attribution.js';
import {DeviceSpeakerAttributionProvider} from './device-speaker-attribution-provider.js';
import {DeviceSpeakerTimeline} from './device-speaker-timeline.js';
import type {TranscriptResult} from '../asr/asr-provider.js';
import {markAcceptedAudioRange} from '../connection/accepted-audio-range.js';
const raw=():TranscriptResult=>({segmentId:'technical',revision:1,turnId:'old-turn',text:'我们要测试模型的在线链路。',language:'zh',
  timing:{startMs:47390,endMs:54185,source:'model'},speaker:{speakerId:'unknown',role:'unknown',source:'unknown'}});
const boundary={boundaryMs:47520,previousSpeakerId:'device-speaker-2',nextSpeakerId:'device-speaker-1',
  previousTurnId:'old-turn',nextTurnId:'new-turn'};
const direct=[{speakerId:'device-speaker-1',startMs:47520,endMs:50520,confidence:0.66,overlap:false},
  {speakerId:'device-speaker-1',startMs:50800,endMs:54160,confidence:0.66,overlap:false}];
const resolve=(through:number|undefined,value=raw(),spans=direct,edges=[boundary])=>
  attributeSpeakerTranscripts([value],spans,()=>undefined,edges,()=>true,{deviceBoundaryPolicy:true,deviceEvidenceThroughMs:through})[0];
it('repairs the exact captured 2901 single-slot interval while preserving its source text and model timing',()=>{
  const f=JSON.parse(readFileSync(new URL('../../../../packages/contracts/fixtures/device-speaker-model-edge-20260929.json',import.meta.url),'utf8'));
  expect(f.spans).toHaveLength(79);
  const before=attributeSpeakerTranscripts([f.transcript],f.spans,()=>undefined,[f.boundary],()=>true,{deviceBoundaryPolicy:true})[0];
  const after=attributeSpeakerTranscripts([f.transcript],f.spans,()=>undefined,[f.boundary],()=>true,
    {deviceBoundaryPolicy:true,deviceEvidenceThroughMs:f.throughMs})[0];
  expect(before.speaker?.speakerId).toBe('unknown');expect(after.speaker?.speakerId).toBe('device-speaker-1');
  expect(after.text).toBe(f.transcript.text);expect(after.timing).toEqual(f.transcript.timing);
});
it('uses complete single-speaker evidence at the observed 130ms model-time edge without changing text or timestamps',()=>{
  const value=raw();value.tokenTimings=[{text:'我们',startMs:47390,endMs:47960,characterStart:0,characterEnd:2}];
  const result=resolve(54185,value);
  expect(result.speaker?.speakerId).toBe('device-speaker-1');expect(result.turnId).toBe('new-turn');
  expect(result.text).toBe(value.text);expect(result.tokenTimings).toEqual(value.tokenTimings);
  expect(result.timing).toMatchObject(value.timing!);
});
it('also repairs a complete trailing edge without changing the model timestamps',()=>{
  const edge={...boundary,boundaryMs:54080,previousSpeakerId:'device-speaker-1',nextSpeakerId:'device-speaker-2'};
  const result=resolve(54185,{...raw(),turnId:'new-turn'},direct,[edge]);
  expect(result.speaker?.speakerId).toBe('device-speaker-1');expect(result.turnId).toBe('old-turn');
  expect(result.timing).toEqual({...raw().timing,overlap:false,activeSpeakerIds:[]});
});
it.each([undefined,54184,0,NaN,Infinity,200000])('cannot use incomplete/invalid/evicted phone watermark %s',through=>{
  expect(resolve(through).speaker?.speakerId).toBe('unknown');
});
it.each([1,48,88,130,159])('never ignores a real %sms rival at the model-time edge',duration=>{
  const rival={speakerId:'device-speaker-2',startMs:47390,endMs:47390+duration,confidence:0.99,overlap:false};
  const result=resolve(54185,raw(),[rival,...direct]);
  expect(result.speaker?.speakerId).toBe('unknown');expect(result.turnId).toBe('old-turn');
});
it('keeps interior/multiple edges, overlap, low coverage/confidence, client clocks and conflicting existing labels conservative',()=>{
  const cases=[
    ()=>resolve(54185,raw(),direct,[{...boundary,boundaryMs:48000}]),
    ()=>resolve(54185,raw(),direct,[boundary,{...boundary,boundaryMs:54000}]),
    ()=>resolve(54185,raw(),direct.map(s=>({...s,overlap:true}))),
    ()=>resolve(54185,raw(),[{...direct[0],endMs:48000}]),
    ()=>resolve(54185,raw(),direct.map(s=>({...s,confidence:0.4}))),
    ()=>resolve(54185,{...raw(),timing:{...raw().timing!,source:'client'}}),
    ()=>resolve(54185,{...raw(),speaker:{speakerId:'device-speaker-2',role:'speaker',source:'diarization'}}),
  ];
  for(const run of cases)expect(run().speaker?.speakerId).toBe('unknown');
});
it('applies labels through original provider and late timeline without moving stored turn lineage or repeating corrections',async()=>{
  const provider=new DeviceSpeakerAttributionProvider('s',16000),updates:any[]=[];
  await provider.createSession({sessionId:'s',options:{mode:'diarization',maxSpeakers:4,deviceProfile:deviceSpeakerProfile.id,allowVoiceIdentity:false}});
  const evidence:DeviceSpeakerEvidenceEvent={type:'speaker.evidence',sessionId:'s',sampleRate:16000,profile:deviceSpeakerProfile.id,
    modelRevision:deviceSpeakerProfile.revision,sequence:1,throughSample:54185*16,
    spans:direct.map(s=>({speaker:0,startSample:s.startMs*16,endSample:s.endMs*16,confidence:s.confidence,overlap:s.overlap}))};
  expect(provider.accept(evidence,evidence.throughSample)).toBe(true);
  expect(provider.refresh([raw()],[boundary])[0]).toMatchObject({turnId:'new-turn',speaker:{speakerId:'device-speaker-1'}});
  const timeline=new DeviceSpeakerTimeline('s',e=>updates.push(e),()=>[boundary]);
  timeline.observe({type:'transcript.final',sessionId:'s',segmentId:'technical',revision:1,turnId:'old-turn',language:'zh',text:raw().text,timing:raw().timing});
  timeline.accept(evidence);
  expect(updates).toHaveLength(1);expect(updates[0]).toMatchObject({turnId:'old-turn',speaker:{speakerId:'device-speaker-1'}});
  timeline.accept({...evidence,sequence:2,throughSample:55000*16,spans:[]});expect(updates).toHaveLength(1);
  await provider.closeSession('s');
  const missing=new DeviceSpeakerAttributionProvider('s',16000),missingUpdates:unknown[]=[];
  await missing.createSession({sessionId:'s',options:{mode:'diarization',maxSpeakers:4,deviceProfile:deviceSpeakerProfile.id,allowVoiceIdentity:false}});
  expect(missing.accept({...evidence,sequence:2},evidence.throughSample)).toBe(true);
  expect(missing.refresh([raw()],[boundary])[0].speaker?.speakerId).toBe('unknown');
  const incomplete=new DeviceSpeakerTimeline('s',e=>missingUpdates.push(e),()=>[boundary]);
  incomplete.observe({type:'transcript.final',sessionId:'s',segmentId:'technical',revision:1,language:'zh',text:raw().text,timing:raw().timing});
  incomplete.accept({...evidence,sequence:2});
  expect(missingUpdates.every((e:any)=>e.speaker.speakerId==='unknown')).toBe(true);
  await missing.closeSession('s');
});
it('does not interpret capacity-evicted annotations as proof of an absent rival',async()=>{
  const provider=new DeviceSpeakerAttributionProvider('dense',16000);
  await provider.createSession({sessionId:'dense',options:{mode:'diarization',maxSpeakers:4,deviceProfile:deviceSpeakerProfile.id,allowVoiceIdentity:false}});
  for(let i=0;i<50;i++){
    const start=i*128,end=start+128;
    expect(provider.accept({type:'speaker.evidence',sessionId:'dense',sampleRate:16000,profile:deviceSpeakerProfile.id,
      modelRevision:deviceSpeakerProfile.revision,sequence:i+1,throughSample:end,
      spans:Array.from({length:128},(_,j)=>({speaker:i===0&&j===0?1:0,startSample:start+j,endSample:start+j+1,confidence:0.99,overlap:false}))},end)).toBe(true);
    const frame={type:'audio.frame' as const,sessionId:'dense',sequence:i+1,timestampMs:0,format:'pcm16' as const,sampleRate:16000 as const,data:Buffer.alloc(256).toString('base64')};
    markAcceptedAudioRange(frame,{startSample:start,endSample:end});await provider.pushAudio(frame);
  }
  const value={...raw(),timing:{startMs:0,endMs:400,source:'model' as const}};
  expect(provider.refresh([value],[{...boundary,boundaryMs:80}])[0].speaker?.speakerId).toBe('unknown');
  await provider.closeSession('dense');
});
