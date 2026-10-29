import {sql,command,activeAccount,assertion} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
import {deviceProof} from './device-proof.mjs';
import {MAX_LEASE_MS,LEASE_DOMAIN,hash,fail,id,integer,digest} from './common.mjs';
import {licenseProfile} from './component-profile.mjs';
import {signLicense} from './license-signing.mjs';
const requestFields=['domain','ownerId','deploymentId','devicePublicKey','requestKey','launchNonce','profile','implementationHash','issuedAtMs','operation','leaseId','sequence'];
export class DeviceLicenseService{
 constructor(store,config,subscriptions){this.store=store;this.config=config;this.subscriptions=subscriptions;}
 async issue(actor,envelope,now){
  const p=await deviceProof(this.store,actor,envelope,LEASE_DOMAIN,this.config.deploymentId,now,requestFields,Infinity),b=p.body;
  digest(b.requestKey);id(b.launchNonce);integer(b.sequence);
  const contract=licenseProfile(b.profile,b.implementationHash,this.config.capabilityProfileV2Enabled);
  if(!['acquire','renew'].includes(b.operation)||!contract)fail('v10_license_contract');
  if(!this.config.admissionOpen)fail('v10_license_admission_closed',503);
  const actorRow=await this.store.read(sql("SELECT t.expires_ms FROM account_tokens t JOIN accounts a ON a.user_id=t.user_id WHERE t.token_hash=? AND t.user_id=? AND t.revoked_ms IS NULL AND t.authorization_epoch=? AND a.authorization_epoch=? AND a.status='active'",actor.tokenHash,actor.id,actor.authorizationEpoch,actor.authorizationEpoch));
  if(!actorRow||actorRow.expires_ms<=now)fail('v10_auth_required',401);
  const requestId=hash([this.config.deploymentId,actor.id,p.keyHash,b.requestKey]),prior=await this.store.read(sql('SELECT * FROM v10_device_license_requests WHERE request_key=?',requestId));
  if(prior){
   if(prior.request_hash!==p.dataHash)fail('v10_license_request_conflict');
   const r=JSON.parse(prior.receipt_json),current=await this.store.read(sql('SELECT state,sequence,expires_ms FROM v10_device_licenses WHERE lease_id=?',r.leaseId));
   const entitlement=await this.subscriptions.entitlement(actor.id,now);
   if(!current||current.state!=='active'||current.sequence!==r.sequence||current.expires_ms<=now||!entitlement.valid||r.expiresAtMs>entitlement.expiresAtMs||r.expiresAtMs>actorRow.expires_ms||r.expiresAtMs>(this.config.windowEndMs??Infinity))fail('v10_license_prior_ended');return r;
  }
  if(Math.abs(now-b.issuedAtMs)>30000)fail('v10_request_expired');
  let leaseId,sequence,starts=now,current,replaced;
  if(b.operation==='renew'){
   id(b.leaseId);current=await this.store.read(sql('SELECT * FROM v10_device_licenses WHERE lease_id=? AND owner_id=?',b.leaseId,actor.id));
   if(!current||current.device_key_hash!==p.keyHash||current.launch_nonce!==b.launchNonce||current.state!=='active'||current.sequence!==b.sequence||current.profile!==contract.profile.profile||current.resource_hash!==contract.hash||now>=current.expires_ms)fail('v10_license_renewal_conflict');
   if(current.expires_ms-now>60000)fail('v10_license_renewal_too_early');
   leaseId=current.lease_id;sequence=current.sequence+1;
  }else{
   if(b.leaseId!==''||b.sequence!==0)fail('v10_license_acquire_binding');
   const busy=await this.store.read(sql("SELECT lease_id FROM v10_device_licenses WHERE owner_id=? AND device_key_hash=? AND state='active' AND expires_ms>?",actor.id,p.keyHash,now));
   if(busy){replaced=await this.store.read(sql('SELECT * FROM v10_device_licenses WHERE lease_id=?',busy.lease_id));if(replaced.launch_nonce===b.launchNonce)fail('v10_device_license_already_active');}
   leaseId='v10d-'+requestId;sequence=1;
  }
  const entitlement=await this.subscriptions.entitlement(actor.id,starts);
  if(!entitlement.valid)fail('v10_entitlement_'+entitlement.status,402);
  const end=Math.min(starts+MAX_LEASE_MS,entitlement.expiresAtMs,actorRow.expires_ms,this.config.windowEndMs??Infinity);
  if(end<=starts||end<=now)fail('v10_entitlement_expired',402);
  const claims={version:contract.version,purpose:'wujie-v10-device-license',execution:'on_device',leaseId,ownerId:actor.id,
   deploymentId:this.config.deploymentId,bundleId:this.config.bundleId,deviceKeyHash:p.keyHash,launchNonce:b.launchNonce,
   requestNonce:b.requestKey,sequence,issuedAtMs:now,notBeforeMs:starts,expiresAtMs:end,
   entitlementKey:entitlement.transactionKey,entitlementRevision:entitlement.revisionHash,
   componentProfile:contract.profile.profile,implementationHash:contract.hash,allowedLanguages:contract.profile.languages};
  const token=signLicense(claims,this.config.signingKeyId,this.config.signingKeyPem),receipt={leaseId,sequence,license:token,expiresAtMs:end,notBeforeMs:starts,entitlementStatus:entitlement.status};
  const c=command('v10-license:'+requestId,actor.id,'v10.device-license.'+b.operation,{dataHash:p.dataHash},now);
  const statusFence=this.config.requireFreshStatus
   ? "s.status IN(1,4) AND s.verified_ms>? AND s.verified_ms<=?"
   : "(s.status IS NULL OR s.status IN(1,4))";
  const statusArgs=this.config.requireFreshStatus?[now-60000,now]:[];
  const statements=[assertion(c,'request_not_cancelled',"NOT EXISTS(SELECT 1 FROM v10_device_license_cancellations WHERE request_key=?)",requestId),activeAccount(c,actor.authorizationEpoch),assertion(c,'auth_token',"EXISTS(SELECT 1 FROM account_tokens WHERE token_hash=? AND user_id=? AND revoked_ms IS NULL AND expires_ms>? AND authorization_epoch=?)",actor.tokenHash,actor.id,now,actor.authorizationEpoch),
   assertion(c,'entitlement_current',`EXISTS(SELECT 1 FROM v10_subscription_transactions t
    LEFT JOIN v10_subscription_status s ON s.chain_key=t.chain_key
    WHERE t.transaction_key=? AND t.owner_id=? AND t.revoked_ms IS NULL AND t.starts_ms<=?
    AND ${statusFence}
    AND (t.expires_ms>=? OR (s.status=4 AND s.grace_expires_ms>=? AND s.verified_ms>? AND s.verified_ms<=?)))`,
    entitlement.transactionKey,actor.id,starts,...statusArgs,end,end,now-60000,now)];
  if(replaced)statements.push(assertion(c,'same_device_replacement',"EXISTS(SELECT 1 FROM v10_device_licenses WHERE lease_id=? AND owner_id=? AND device_key_hash=? AND launch_nonce=?)",replaced.lease_id,actor.id,p.keyHash,replaced.launch_nonce),sql("UPDATE v10_device_licenses SET state='closed',updated_ms=? WHERE lease_id=?",now,replaced.lease_id));
  if(current){statements.push(assertion(c,'license_sequence',"EXISTS(SELECT 1 FROM v10_device_licenses WHERE lease_id=? AND state='active' AND sequence=? AND expires_ms=?)",leaseId,current.sequence,current.expires_ms),
   sql("UPDATE v10_device_licenses SET sequence=?,starts_ms=?,expires_ms=?,entitlement_key=?,entitlement_revision=?,updated_ms=? WHERE lease_id=? AND sequence=?",sequence,starts,end,entitlement.transactionKey,entitlement.revisionHash,now,leaseId,current.sequence));
  }else{statements.push(assertion(c,'device_not_busy',"NOT EXISTS(SELECT 1 FROM v10_device_licenses WHERE owner_id=? AND device_key_hash=? AND state='active' AND expires_ms>?)",actor.id,p.keyHash,now),
   sql("INSERT INTO v10_device_licenses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)",leaseId,actor.id,p.keyHash,b.launchNonce,contract.profile.profile,contract.hash,'zh','en',sequence,starts,end,entitlement.transactionKey,entitlement.revisionHash,now,now));}
  statements.push(sql('INSERT INTO v10_device_license_requests VALUES(?,?,?,?,?,?)',requestId,actor.id,p.dataHash,leaseId,JSON.stringify(receipt),now));
  const result=await this.store.execute(c,{statements,receipt:sql('SELECT ? AS receipt',JSON.stringify(receipt))});return result.receipt;
 }
 async resolve(actor,envelope,now){
  const token=await this.store.read(sql("SELECT 1 ok FROM account_tokens t JOIN accounts a ON a.user_id=t.user_id WHERE t.token_hash=? AND t.user_id=? AND t.revoked_ms IS NULL AND t.expires_ms>? AND t.authorization_epoch=? AND a.authorization_epoch=? AND a.status='active'",actor.tokenHash,actor.id,now,actor.authorizationEpoch,actor.authorizationEpoch));
  if(!token)fail('v10_auth_required',401);
  const p=await deviceProof(this.store,actor,envelope,LEASE_DOMAIN,this.config.deploymentId,now,requestFields,Infinity),b=p.body;
  digest(b.requestKey);const requestId=hash([this.config.deploymentId,actor.id,p.keyHash,b.requestKey]);
  const lookup=()=>this.store.read(sql('SELECT request_hash,receipt_json FROM v10_device_license_requests WHERE request_key=?',requestId));
  let row=await lookup();
  if(!row){
   const c=command('v10-license-cancel:'+requestId,actor.id,'v10.device-license.cancel-absent',{dataHash:p.dataHash},now);
   try{await this.store.execute(c,{statements:[activeAccount(c,actor.authorizationEpoch),
    assertion(c,'absent','NOT EXISTS(SELECT 1 FROM v10_device_license_requests WHERE request_key=?)',requestId),
    sql('INSERT INTO v10_device_license_cancellations VALUES(?,?,?,?)',requestId,actor.id,p.dataHash,now)],receipt:sql("SELECT json_object('status','cancelled') AS receipt")});}
   catch(error){row=await lookup();if(!row)throw error;}
   if(!row)return {status:'cancelled'};
  }
  if(row.request_hash!==p.dataHash)fail('v10_license_request_conflict');
  const receipt=JSON.parse(row.receipt_json),current=await this.store.read(sql('SELECT state,sequence FROM v10_device_licenses WHERE lease_id=?',receipt.leaseId));
  const e=await this.subscriptions.entitlement(actor.id,now);
  if(!current||current.state!=='active'||current.sequence!==receipt.sequence||receipt.expiresAtMs<=now||!e.valid||receipt.expiresAtMs>e.expiresAtMs)return {status:'ended'};
  return {status:'issued',...receipt};
 }
 async close(envelope,now){
  const encoded=envelope?.clientData;let b;try{b=JSON.parse(Buffer.from(encoded,'base64').toString());}catch{fail('v10_device_proof');}
  id(b.leaseId);const row=await this.store.read(sql('SELECT * FROM v10_device_licenses WHERE lease_id=?',b.leaseId));if(!row)fail('v10_license_not_found',404);
  const allowed=['domain','ownerId','deploymentId','devicePublicKey','leaseId','launchNonce','sequence','activeMs','issuedAtMs','reason'];
  const p=await deviceProof(this.store,{id:row.owner_id},envelope,'wujie.v10.device-license.close.v1',this.config.deploymentId,now,allowed,Infinity);
  b=p.body;integer(b.sequence,1);if(p.keyHash!==row.device_key_hash||b.launchNonce!==row.launch_nonce||b.sequence>row.sequence)fail('v10_license_close_binding');
  integer(b.activeMs);if(b.issuedAtMs>now+300000||b.activeMs>MAX_LEASE_MS*b.sequence)fail('v10_device_statistics_invalid');
  const c=command('v10-license-close:'+row.lease_id+':'+b.sequence,row.owner_id,'v10.device-license.close',{dataHash:p.dataHash},now);
  const result=await this.store.execute(c,{statements:[sql("UPDATE v10_device_licenses SET state='closed',updated_ms=? WHERE lease_id=? AND sequence=?",now,row.lease_id,b.sequence),
   sql('INSERT INTO v10_device_statistics VALUES(?,?,?,?,?,?) ON CONFLICT(lease_id,sequence) DO NOTHING',row.lease_id,row.owner_id,b.sequence,b.activeMs,p.dataHash,now)],
   receipt:sql("SELECT json_object('leaseId',?,'sequence',?,'status','closed','meterBasis','device_reported_statistics','chargedSeconds',0) AS receipt",row.lease_id,b.sequence)});
  return result.receipt;
 }
}
