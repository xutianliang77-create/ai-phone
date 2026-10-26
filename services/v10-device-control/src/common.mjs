import {createHash} from 'node:crypto';
export const PROFILE='apple-system-zh-en-v10-r1';
export const LEASE_DOMAIN='wujie.v10.device-license.request.v1';
export const PURCHASE_DOMAIN='wujie.v10.storekit-proof.v1';
export const EXECUTION='on_device';
export const MAX_LEASE_MS=1800000;
export const hash=v=>createHash('sha256').update(typeof v==='string'||ArrayBuffer.isView(v)?v:canonical(v)).digest('hex');
export function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';return JSON.stringify(v)??'null';}
export function fail(code,status=409){throw Object.assign(Error(code),{code,status});}
export function id(v,max=160){if(typeof v!=='string'||!v||v.length>max||!/^[A-Za-z0-9._:-]+$/.test(v))fail('v10_invalid_identifier');return v;}
export function integer(v,min=0){if(!Number.isSafeInteger(v)||v<min)fail('v10_invalid_integer');return v;}
export function fields(v,allowed,required=allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(v,k)))fail('v10_invalid_fields',400);return v;}
export function pair(source,target){if(!['zh','en'].includes(source)||!['zh','en'].includes(target)||source===target)fail('v10_language_pair_not_qualified');}
export function digest(v){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('v10_invalid_digest');return v;}
