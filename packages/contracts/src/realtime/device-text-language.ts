/** Text evidence only. Neither a vendor language result nor acoustic LID. */
export const DEVICE_TEXT_LANGUAGE_PROTOCOL = 'ai-phone.text-language.v1';
export const DEVICE_TEXT_LANGUAGE_METHOD = 'apple_nl_text_v1';
/** Explicit optional capability: never send extended challenges to old Apps. */
export const DEVICE_SPEECH_EVIDENCE_PROTOCOL = 'ai-phone.speech-evidence.v1';
export interface DeviceTextLanguageBinding {
  sessionId:string; requestId:string; segmentId:string; revision:number; textSha256:string;
}
export interface DeviceTextLanguageRequest extends DeviceTextLanguageBinding {
  type:'text.language.request'; text:string; method:typeof DEVICE_TEXT_LANGUAGE_METHOD;
  /** Optional capture-sample range. Quality evidence only, never billing or acoustic LID. */
  audioRange?:DeviceSpeechAudioRange;
}
export interface DeviceTextLanguageResult extends DeviceTextLanguageBinding {
  type:'text.language.result'; method:typeof DEVICE_TEXT_LANGUAGE_METHOD;
  evidence:'text_only_not_acoustic'; dominant:string|null; hypotheses:Record<string,number>;
  audioEvidence?:DeviceSpeechAudioEvidence;
}
export interface DeviceSpeechAudioRange {startSample:number;endSample:number;sampleRate:16000|24000}
export interface DeviceSpeechAudioEvidence {
  method:'ios_silero_render_v1';range:DeviceSpeechAudioRange;
  decision:'speech'|'non_speech'|'unknown';coveredThroughSample:number;
  reason:'speech_overlap'|'no_speech_support'|'render_echo'|'unavailable'|'uncovered'|'stale';
}
export function isDeviceSpeechAudioRange(value:unknown):value is DeviceSpeechAudioRange {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).length===3&&['startSample','endSample','sampleRate'].every(k=>Object.hasOwn(v,k))&&
    [16000,24000].includes(Number(v.sampleRate))&&typeof v.sampleRate==='number'&&
    Number.isSafeInteger(v.startSample)&&Number.isSafeInteger(v.endSample)&&Number(v.startSample)>=0&&
    Number(v.endSample)>Number(v.startSample)&&Number(v.endSample)-Number(v.startSample)<=Number(v.sampleRate)*60;
}
export function isDeviceSpeechAudioEvidence(value:unknown):value is DeviceSpeechAudioEvidence {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).length===5&&['method','range','decision','coveredThroughSample','reason'].every(k=>Object.hasOwn(v,k))&&
    v.method==='ios_silero_render_v1'&&isDeviceSpeechAudioRange(v.range)&&
    ['speech','non_speech','unknown'].includes(String(v.decision))&&Number.isSafeInteger(v.coveredThroughSample)&&Number(v.coveredThroughSample)>=0&&
    ['speech_overlap','no_speech_support','render_echo','unavailable','uncovered','stale'].includes(String(v.reason))&&
    (v.decision!=='non_speech'||Number(v.coveredThroughSample)>=v.range.endSample&&['no_speech_support','render_echo'].includes(String(v.reason)))&&
    (v.decision!=='speech'||v.reason==='speech_overlap');
}
export function isDeviceTextLanguageResult(value:unknown):value is DeviceTextLanguageResult {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  const keys=['type','sessionId','requestId','segmentId','revision','textSha256','method','evidence','dominant','hypotheses'];
  const key=(x:unknown)=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,240}$/.test(x);
  const locale=(x:unknown)=>typeof x==='string'&&/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(x);
  if(Object.keys(v).some(k=>!keys.includes(k)&&k!=='audioEvidence')||keys.some(k=>!Object.hasOwn(v,k))||
    v.type!=='text.language.result'||v.method!==DEVICE_TEXT_LANGUAGE_METHOD||v.evidence!=='text_only_not_acoustic'||
    !key(v.sessionId)||!key(v.segmentId)||!key(v.requestId)||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||
    typeof v.textSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.textSha256)||v.dominant!==null&&!locale(v.dominant)||
    !v.hypotheses||typeof v.hypotheses!=='object'||Array.isArray(v.hypotheses)||
    Object.hasOwn(v,'audioEvidence')&&!isDeviceSpeechAudioEvidence(v.audioEvidence))return false;
  const entries=Object.entries(v.hypotheses);
  return entries.length<=3&&entries.every(([language,p])=>locale(language)&&typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1)&&
    entries.reduce((sum,[,p])=>sum+Number(p),0)<=1.000001&&
    (v.dominant===null?entries.length===0:Object.hasOwn(v.hypotheses,v.dominant as string));
}
