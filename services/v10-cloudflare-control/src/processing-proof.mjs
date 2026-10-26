import {createHmac,timingSafeEqual} from 'node:crypto';
import {sha} from './environment.mjs';
import {fail,strongKey} from './protocol.mjs';
const domain='wujie.v10-control.issue-from-processing.v1';
export function verifyProcessingIssue(proof,envelope,env,now){
 if(!strongKey(env.INTERNAL_API_SECRET)||typeof proof!=='string'||proof.length>3000)fail('v10_processing_proof_required');
 const [data,sig,extra]=proof.split('.'),expected=createHmac('sha256',env.INTERNAL_API_SECRET).update(domain+'\0'+data).digest(),actual=Buffer.from(sig??'','base64url');
 if(extra||actual.length!==expected.length||!timingSafeEqual(actual,expected))fail('v10_processing_proof_invalid');
 let body;try{body=JSON.parse(Buffer.from(data,'base64url').toString());}catch{fail('v10_processing_proof_invalid');}
 if(body.domain!==domain||body.deploymentId!==env.PUBLIC_DEPLOYMENT_ID||body.envelopeHash!==sha({clientData:envelope.clientData,deviceSignature:envelope.deviceSignature})||
  !Number.isSafeInteger(body.issuedAtMs)||Math.abs(now-body.issuedAtMs)>30000)fail('v10_processing_proof_binding');
}
