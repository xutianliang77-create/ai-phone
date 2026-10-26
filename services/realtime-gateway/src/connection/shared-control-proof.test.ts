import {afterEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import type {WebSocket} from 'ws';
import {createSession,deleteSession} from '../sessions/session-manager.js';
import {proveSharedControlConnection} from './shared-control-proof.js';
describe('hardware-key protocol using synthetic P256 keys',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 async function attempt(copied:boolean){
  vi.stubEnv('V10_CONTROL_DEPLOYMENT_ID','wujie-v10-fixture');
  const device=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=device.publicKey.export({format:'jwk'}),raw=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x!,'base64url'),Buffer.from(jwk.y!,'base64url')]);
  const session=createSession({sessionId:'v10-proof-'+Math.random(),userId:'owner',planCode:'fixture',maxDurationSeconds:100,issuedAt:Date.now()/1000,expiresAt:Date.now()/1000+300,sourceLanguage:'zh',targetLanguage:'en',voiceOutput:false,
   control:{contractVersion:1,execution:'retained_v10_processing',ownerId:'owner',deploymentId:'wujie-v10-fixture',devicePublicKey:raw.toString('base64'),deviceKeyHash:createHash('sha256').update(raw).digest('hex'),planHash:'a'.repeat(64),bindingHash:'b'.repeat(64),expiresAtMs:Date.now()+160000}});
  const socket=new EventEmitter() as EventEmitter&{send:(s:string)=>void};
  socket.send=s=>{const c=JSON.parse(s),bytes=Buffer.from(c.clientData,'base64');
   const signature=copied?Buffer.alloc(64):sign('sha256',bytes,{key:device.privateKey,dsaEncoding:'ieee-p1363'});
   queueMicrotask(()=>socket.emit('message',JSON.stringify({type:'session.control.proof',sessionId:session.id,signature:signature.toString('base64')})));
  };
  try{return await proveSharedControlConnection(socket as WebSocket,session,100);}finally{session.providerCloseConfirmed=true;deleteSession(session.id);}
 }
 it('accepts the bound key and a fresh server nonce',async()=>{await expect(attempt(false)).resolves.toBeUndefined();});
 it('rejects a copied ticket without its device private key',async()=>{await expect(attempt(true)).rejects.toThrow('control_device_proof_signature');});
});
