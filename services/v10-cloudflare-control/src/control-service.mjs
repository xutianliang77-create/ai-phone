import {D1UsageHoldsRepository, assertion, command, activeAccount, sql} from '../vendor/reused-control-core.mjs';
import {hash, fail, privatePolicy, encodeToken, verifyIssueEnvelope, verifyInternal, requireSessionId, execution, guardedStore} from './protocol.mjs';
import {finishControl, cancelUnadmitted} from './settlement.mjs';
import {requestSessionId,resolveRequest} from './request-resolution.mjs';
import {servingControl} from './serving.mjs';

/** Account/device identity and the wallet are reused from 1.1. This service
 * never imports ASR/MT/TTS providers and never receives inference content. */
export class V10ControlService {
  constructor(store, config) { this.store=store; this.config=config; }
  configuration() { const policy=privatePolicy(this.config); return {contractVersion:1, ...policy, planHash:hash(policy)}; }
  async issue(actor,envelope,now) {
    const config=this.configuration(), verified=verifyIssueEnvelope(envelope,actor,this.config.deploymentId,config.planHash), b=verified.body;
    const sid=requestSessionId(this.config.deploymentId,actor.id,b.requestKey);
    const c=command('v10-issue:'+sid,actor.id,'v10.control.issue',{dataHash:verified.dataHash,authorizationEpoch:actor.authorizationEpoch,tokenHash:actor.tokenHash},now);
    const authorization=await this.requireActor(actor,now);
    const key=await this.store.read(sql('SELECT owner_id FROM device_permit_keys WHERE device_key_hash=?',verified.deviceKeyHash));
    if (!key || key.owner_id!==actor.id) fail('v10_attested_device_required');
    const replay=await this.store.replay(c);
    if (replay) {
      const row=await this.session(sid);
      if (!['prepared','active'].includes(row.state) || replay.receipt.expiresAtMs<=now) fail('v10_authorization_expired');
      return replay.receipt;
    }
    const bindingHash=hash([sid,actor.id,verified.deviceKeyHash,verified.dataHash,actor.authorizationEpoch]);
    const guarded=guardedStore(this.store,c=>[assertion(c,'request_not_cancelled',
      'NOT EXISTS(SELECT 1 FROM command_results WHERE command_id=?)','v10-cancel-request:'+sid),assertion(c,'v10_single_execution',
      "(SELECT COUNT(*) FROM public_sessions WHERE session_id LIKE 'v10-%' AND deployment_id=? AND state IN ('prepared','active'))<? AND NOT EXISTS(SELECT 1 FROM public_sessions WHERE session_id LIKE 'v10-%' AND deployment_id=? AND owner_id=? AND state IN ('prepared','active'))",this.config.deploymentId,config.maximumConcurrentSessions,this.config.deploymentId,actor.id)]);
    const holds=new D1UsageHoldsRepository(guarded,this.config.deploymentId);
    let row=await this.store.read(sql('SELECT * FROM public_sessions WHERE session_id=?',sid));
    if(!row) {
    if (Math.abs(now-b.issuedAtMs)>30000) fail('v10_request_expired');
    const balance=await holds.balance(actor.id), seconds=Math.min(config.maximumSeconds,balance.availableSeconds);
    if (seconds<30) {
      row=await this.store.read(sql('SELECT * FROM public_sessions WHERE session_id=?',sid));
      if(!row)fail('v10_quota_not_enough');
    } else {
    const expiresMs=Math.min(now+(seconds+config.preparationGraceSeconds)*1000,authorization.expires_ms);
    if(expiresMs<now+30000)fail('v10_account_expiring');
    const hold=await holds.create({sessionId:sid,ownerId:actor.id,deploymentId:this.config.deploymentId,
      configurationHash:config.planHash,bindingHash,authTokenHash:actor.tokenHash,authorizationEpoch:actor.authorizationEpoch,
      captureEpoch:0,languageConfigKey:b.sourceLanguage+'->'+b.targetLanguage,seconds,
      note:'v10 retained execution; verified processing-gateway stop required',expiresMs},now);
    if (hold.receipt.status!=='held') fail('v10_quota_not_enough');
    }
    }
    row=await this.session(sid);
    const reservation=await this.store.read(sql('SELECT seconds,expires_ms FROM credit_reservations WHERE session_id=? AND user_id=?',sid,actor.id));
    if (row.binding_hash!==bindingHash || row.state!=='prepared') fail('v10_session_binding');
    const expiresAtMs=reservation.expires_ms, issuedAt=Math.floor(row.created_ms/1000);
    const control={contractVersion:1,execution,ownerId:actor.id,deploymentId:this.config.deploymentId,devicePublicKey:b.devicePublicKey,
      deviceKeyHash:verified.deviceKeyHash,planHash:config.planHash,bindingHash,expiresAtMs};
    const receipt={contractVersion:1,execution,sessionId:sid,ownerId:actor.id,deploymentId:this.config.deploymentId,
      endpoint:config.endpoint,processingApiBaseUrl:config.processingApiBaseUrl,expiresAtMs,expiresAt:new Date(Math.min(expiresAtMs,(issuedAt+300)*1000)).toISOString(),
      maxDurationSeconds:reservation.seconds,controlBinding:control,
      realtimeToken:encodeToken({...verified.options,sessionId:sid,userId:actor.id,
        planCode:'shared-control',maxDurationSeconds:reservation.seconds,holdSeconds:reservation.seconds,
        issuedAt,expiresAt:issuedAt+300,control},this.config.signingSecret)};
    await this.store.execute(c,{statements:[assertion(c,'v10_scope',"EXISTS(SELECT 1 FROM public_sessions WHERE session_id=? AND owner_id=? AND binding_hash=? AND state='prepared')",sid,actor.id,bindingHash)],
      receipt:sql('SELECT ? AS receipt',JSON.stringify(receipt))});
    return receipt;
  }
  serving(proof,now,fresh=false) { return servingControl(this,proof,now,fresh); }
  resolve(actor,key,now,cancel=false) { return resolveRequest(this,actor,key,now,cancel); }
  async requireActor(actor,now) {
    const valid=await this.store.read(sql(`SELECT t.expires_ms FROM account_tokens t JOIN accounts a ON a.user_id=t.user_id
      WHERE t.token_hash=? AND t.user_id=? AND t.authorization_epoch=? AND t.revoked_ms IS NULL AND t.expires_ms>?
      AND a.status='active' AND a.authorization_epoch=?`,actor.tokenHash,actor.id,actor.authorizationEpoch,now,actor.authorizationEpoch));
    if(!valid)fail('v10_authorization_revoked');
    return valid;
  }
  async session(id) { requireSessionId(id);const row=await this.store.read(sql('SELECT * FROM public_sessions WHERE session_id=? AND deployment_id=?',id,this.config.deploymentId));if(!row)fail('v10_session_not_found');return row; }
  finish(receipt,now) { return finishControl(this,receipt,now); }
  cancel(actor,id,now) { return cancelUnadmitted(this,actor,id,now); }
}
