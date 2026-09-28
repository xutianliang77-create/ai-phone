import {it,expect,vi,afterEach} from 'vitest';
import {emptyConfiguration,validateProfile,mergeConfiguration,publicModelCatalog} from './public-model-config.js';
import * as store from './public-model-config-store.js';
import {capturePublicModelRuntimeConfiguration,resolvePublicModelRuntimeCredentials} from './public-model-runtime-config.js';
afterEach(()=>vi.restoreAllMocks());
it('new streaming protocol has separate settings, signed silent/spoken identity and no old realtime-field carryover',()=>{
  let current=emptyConfiguration('test');current.revision=1;
  for(const c of ['asr','translation','tts'] as const){current.components[c].endpoint=c==='translation'?'https://synthetic.invalid':'wss://synthetic.invalid';current.components[c].modelId='manual';current.credentials[c]={apiKey:'SYNTHETIC'};}
  Object.assign(current.components.asr,{protocol:'qwen_audio_streaming',endpoint:'wss://synthetic.invalid/api-ws/v1/inference'});
  current.components.tts.voice='configured-voice';
  vi.spyOn(store,'selectPublicModelConfigurationInternal').mockImplementation(select=>select(current));
  const before=[false,true].map(capturePublicModelRuntimeConfiguration);
  expect(before[0].components.asr!.streaming).toEqual({semanticPunctuation:true,heartbeat:true});
  const components=structuredClone(current.components);components.asr.streaming={semanticPunctuation:false,heartbeat:true};
  current=mergeConfiguration(current,{expectedRevision:1,components});
  for(const [i,voice]of [false,true].entries()){
    expect(capturePublicModelRuntimeConfiguration(voice).configurationHash).not.toBe(before[i].configurationHash);
    expect(()=>resolvePublicModelRuntimeCredentials(before[i],'asr')).toThrow('config_changed');
  }
  expect(()=>validateProfile('asr',{...current.components.asr,serverVad:{threshold:0.2,silenceDurationMs:400}})).toThrow('invalid_server_vad');
  expect(()=>validateProfile('asr',{...current.components.asr,endpoint:'wss://synthetic.invalid/api-ws/v1/realtime'})).toThrow('inference');
  for(const p of publicModelCatalog.protocols.filter(p=>p.component==='asr'&&p.id!=='qwen_audio_streaming'))
    expect(()=>validateProfile('asr',{...current.components.asr,vendor:p.vendor,protocol:p.id,authKind:p.auth[0]})).toThrow('invalid_streaming');
});
