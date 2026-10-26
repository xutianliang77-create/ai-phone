import {createHash,createPublicKey,randomBytes,verify} from 'node:crypto';
import type {WebSocket} from 'ws';
import type {RealtimeSession} from '../sessions/realtime-session.js';

export async function proveSharedControlConnection(ws:WebSocket,session:RealtimeSession,timeoutMs=5000){
  const control=session.claims.control;if(!control)return;
  if(control.execution!=='retained_v10_processing'||control.ownerId!==session.userId||
      control.contractVersion!==1||control.deploymentId!==process.env.V10_CONTROL_DEPLOYMENT_ID||
      !Number.isSafeInteger(control.expiresAtMs)||control.expiresAtMs<=Date.now()||
      control.expiresAtMs>Date.now()+1860000||!control.devicePublicKey||
      !/^[a-f0-9]{64}$/.test(control.planHash)||!/^[a-f0-9]{64}$/.test(control.bindingHash))throw Error('control_ticket_binding');
  const raw=Buffer.from(control.devicePublicKey,'base64');
  if(raw.length!==65||raw[0]!==4||createHash('sha256').update(raw).digest('hex')!==control.deviceKeyHash)throw Error('control_device_key');
  const nonce=randomBytes(32).toString('hex'),challenge={domain:'wujie.v10-control.connection.v1',ownerId:session.userId,
    deploymentId:control.deploymentId,sessionId:session.id,deviceKeyHash:control.deviceKeyHash,planHash:control.planHash,
    nonce,expiresAtMs:Math.min(control.expiresAtMs,Date.now()+timeoutMs)};
  const bytes=Buffer.from(JSON.stringify(challenge));
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>finish(Error('control_device_proof_timeout')),timeoutMs);
    const finish=(error?:Error)=>{clearTimeout(timer);ws.off('message',message);ws.off('close',closed);error?reject(error):resolve();};
    const closed=()=>finish(Error('control_device_proof_closed'));
    const message=(data:unknown)=>{
      try{
        const body=JSON.parse(String(data));
        if(body.type!=='session.control.proof'||body.sessionId!==session.id||typeof body.signature!=='string')throw Error('control_device_proof_binding');
        const key=createPublicKey({key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},format:'jwk'});
        const signature=Buffer.from(body.signature,'base64');
        if(signature.length!==64||!verify('sha256',bytes,{key,dsaEncoding:'ieee-p1363'},signature))throw Error('control_device_proof_signature');
        finish();
      }catch(error){finish(error instanceof Error?error:Error('control_device_proof_failed'));}
    };
    ws.once('message',message);ws.once('close',closed);
    ws.send(JSON.stringify({type:'session.control.challenge',sessionId:session.id,clientData:bytes.toString('base64')}));
  });
  session.controlPreviousNonce=session.providerCloseConfirmed===true?session.controlConnectionNonce:undefined;
  session.controlConnectionNonce=nonce;
}
