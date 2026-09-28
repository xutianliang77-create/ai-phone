/** Text evidence only. Neither a vendor language result nor acoustic LID. */
export const DEVICE_TEXT_LANGUAGE_PROTOCOL = 'ai-phone.text-language.v1';
export const DEVICE_TEXT_LANGUAGE_METHOD = 'apple_nl_text_v1';
export interface DeviceTextLanguageBinding {
  sessionId:string; requestId:string; segmentId:string; revision:number; textSha256:string;
}
export interface DeviceTextLanguageRequest extends DeviceTextLanguageBinding {
  type:'text.language.request'; text:string; method:typeof DEVICE_TEXT_LANGUAGE_METHOD;
}
export interface DeviceTextLanguageResult extends DeviceTextLanguageBinding {
  type:'text.language.result'; method:typeof DEVICE_TEXT_LANGUAGE_METHOD;
  evidence:'text_only_not_acoustic'; dominant:string|null; hypotheses:Record<string,number>;
}
export function isDeviceTextLanguageResult(value:unknown):value is DeviceTextLanguageResult {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  const keys=['type','sessionId','requestId','segmentId','revision','textSha256','method','evidence','dominant','hypotheses'];
  const key=(x:unknown)=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,240}$/.test(x);
  const locale=(x:unknown)=>typeof x==='string'&&/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(x);
  if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||
    v.type!=='text.language.result'||v.method!==DEVICE_TEXT_LANGUAGE_METHOD||v.evidence!=='text_only_not_acoustic'||
    !key(v.sessionId)||!key(v.segmentId)||!key(v.requestId)||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||
    typeof v.textSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.textSha256)||v.dominant!==null&&!locale(v.dominant)||
    !v.hypotheses||typeof v.hypotheses!=='object'||Array.isArray(v.hypotheses))return false;
  const entries=Object.entries(v.hypotheses);
  return entries.length<=3&&entries.every(([language,p])=>locale(language)&&typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1)&&
    entries.reduce((sum,[,p])=>sum+Number(p),0)<=1.000001&&
    (v.dominant===null?entries.length===0:Object.hasOwn(v.hypotheses,v.dominant as string));
}
