import {createPublicKey,verify} from 'node:crypto';
import {sql} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {hash,fail,fields,integer,digest} from './common.mjs';
/** Registration requires App Attest. Operations additionally require possession
 * of that owner's registered enclave key, a purpose and an immutable request. */
export async function deviceProof(store,actor,envelope,domain,deployment,now,allowed,maxAgeMs=30000){
 fields(envelope,['clientData','deviceSignature']);
 if(typeof envelope.clientData!=='string'||envelope.clientData.length>90000||typeof envelope.deviceSignature!=='string')fail('v10_device_proof');
 let bytes,body,raw;
 try{bytes=Buffer.from(envelope.clientData,'base64');body=JSON.parse(bytes.toString());raw=Buffer.from(body.devicePublicKey,'base64');}catch{fail('v10_device_proof');}
 fields(body,allowed);if(body.domain!==domain||body.ownerId!==actor.id||body.deploymentId!==deployment||(integer(body.issuedAtMs)>now+300000||now-body.issuedAtMs>maxAgeMs))fail('v10_device_binding',403);
 if(raw.length!==65||raw[0]!==4)fail('v10_device_public_key',403);
 const keyHash=hash(raw),key=await store.read(sql('SELECT owner_id FROM device_permit_keys WHERE device_key_hash=?',keyHash));
 if(!key||key.owner_id!==actor.id)fail('v10_attested_device_required',403);
 const publicKey=createPublicKey({key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},format:'jwk'}),sig=Buffer.from(envelope.deviceSignature,'base64');
 if(sig.length!==64||!verify('sha256',bytes,{key:publicKey.export({type:'spki',format:'pem'}),dsaEncoding:'ieee-p1363'},sig))fail('v10_device_signature',403);
 return {body,keyHash,dataHash:hash(bytes)};
}
