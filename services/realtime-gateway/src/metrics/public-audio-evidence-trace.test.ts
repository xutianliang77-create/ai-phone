import {afterEach,expect,it,vi} from 'vitest';
import {deviceSpeakerProfile,type DeviceSpeakerEvidenceEvent} from '@translation/contracts';
import {DeviceSpeakerAttributionProvider} from '../speaker/device-speaker-attribution-provider.js';
import {DeviceSpeakerTimeline} from '../speaker/device-speaker-timeline.js';
import {realtimeLogger} from './realtime-metrics.js';
import {tracePublicAsrFinal} from './public-audio-evidence-trace.js';
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
const evidence:DeviceSpeakerEvidenceEvent={type:'speaker.evidence',sessionId:'session',profile:deviceSpeakerProfile.id,
  modelRevision:deviceSpeakerProfile.revision,sequence:1,sampleRate:16000,throughSample:16000,
  spans:[{speaker:1,startSample:0,endSample:16000,confidence:0.9,overlap:false}]};
it('records accepted speaker evidence, its original timeline projection, and ASR offsets without content',async()=>{
  vi.stubEnv('PUBLIC_ASR_BOUNDARY_TRACE_ENABLED','true');const log=vi.spyOn(realtimeLogger,'info').mockImplementation(()=>{});
  const provider=new DeviceSpeakerAttributionProvider('session',16000);
  await provider.createSession({sessionId:'session',options:{mode:'diarization',maxSpeakers:4,allowVoiceIdentity:false,deviceProfile:deviceSpeakerProfile.id}});
  expect(provider.accept({...evidence,sessionId:'other'},16000)).toBe(false);expect(log).not.toHaveBeenCalled();
  expect(provider.accept(evidence,16000)).toBe(true);
  const updates:unknown[]=[],timeline=new DeviceSpeakerTimeline('session',e=>updates.push(e));
  timeline.accept(evidence);timeline.observe({type:'transcript.final',sessionId:'session',segmentId:'s',revision:1,text:'PRIVATE',language:'en',timing:{startMs:0,endMs:1000,source:'model'}});
  tracePublicAsrFinal('session','s','PRIVATE',0,1000,[{text:'PRIVATE',characterStart:0,characterEnd:7,startMs:0,endMs:1000}]);
  expect(updates).toHaveLength(1);
  expect(log.mock.calls.map(c=>(c[0] as any).stage)).toEqual(['phone_speaker_evidence','gateway_speaker_association','provider_final']);
  expect(log.mock.calls[0][0]).toMatchObject({acceptedSamples:16000,throughSample:16000,spans:evidence.spans});
  expect(log.mock.calls[1][0]).toMatchObject({updates:[{speakerId:'device-speaker-2',segmentId:'s',revision:1}]});
  expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');
  await provider.closeSession('session');
});
it('is opt-in and logging failure cannot change the original processing result',async()=>{
  const log=vi.spyOn(realtimeLogger,'info').mockImplementation(()=>{throw Error('log unavailable');});
  tracePublicAsrFinal('s','a','secret',0,100);expect(log).not.toHaveBeenCalled();
  vi.stubEnv('PUBLIC_ASR_BOUNDARY_TRACE_ENABLED','true');
  expect(()=>tracePublicAsrFinal('s','a','secret',0,100)).not.toThrow();
});
