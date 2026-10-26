import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Fixture,now,deployment,bundle} from './fixture.js';
import {D1PurchasesRepository} from './fixture-grants.mjs';
import {V10ControlService} from '../src/control-service.mjs';
import {D1UsageHoldsRepository} from '../vendor/reused-control-core.mjs';
import {hash,issueDomain,internalProof} from '../src/protocol.mjs';
import {signGatewayStopReceipt} from '../../../packages/platform-security/src/gateway-stop-receipt.js';

const secret='fixture-only-processing-gateway-signing-secret';
const config={enabled:true,qualifiedBackend:true,gatewayContract:'v10-control-proof-v1',deploymentId:deployment,
  endpoint:'wss://processing.publisher.cn/realtime',processingApiBaseUrl:'https://processing.publisher.cn',maximumSeconds:1800,maximumConcurrentSessions:1,
  revision:'synthetic-qualified-fixture-not-production',signingSecret:secret};

describe('v10 shared control: original 1.1 wallet, no model provider',()=>{
  let f:Fixture,actor:{id:string;tokenHash:string;authorizationEpoch:number},keys:ReturnType<typeof generateKeyPairSync>,publicKey:string;
  beforeEach(async()=>{
    f=new Fixture();
    for(const name of ['0006_apple_billing_events.sql','0009_device_permits.sql'])
      f.db.exec(readFileSync(new URL('./sql/commerce/'+name,import.meta.url),'utf8'));
    ({actor,keys,publicKey}=await owner('owner-a'));
  });
  afterEach(()=>f.db.close());
  function service(){return new V10ControlService(f.store(),config);}
  async function owner(id:string,seconds=100){
    const user=f.seedUser(id),keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=keys.publicKey.export({format:'jwk'});
    const raw=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x!,'base64url'),Buffer.from(jwk.y!,'base64url')]);
    f.db.prepare('INSERT INTO device_permit_keys VALUES(?,?,?,?,?,?,0,?,?)').run(hash(raw),id,raw.toString('base64'),
      'synthetic-attest-key-'+id,'synthetic-attest-public','synthetic-registration',now,now);
    await new D1PurchasesRepository(f.store(),{bundleId:bundle,environment:'Sandbox'}).grant({
      ownerId:id,environment:'Sandbox',bundleId:bundle,transactionId:'synthetic-credits-'+id,
      appAccountToken:user.appAccountToken,quantity:1,product:{productId:'fixture-credit-'+seconds,version:'fixture',unitSeconds:seconds,priceMinorUnits:1,currency:'CNY'},
      proofRef:'host-memory-fixture-not-real-purchase'},now);
    return {actor:{id,tokenHash:user.tokenHash,authorizationEpoch:1},keys,publicKey:raw.toString('base64')};
  }
  function envelope(requestKey='a'.repeat(64),who=actor,key=keys,pub=publicKey){
    const body={domain:issueDomain,requestKey,deploymentId:deployment,ownerId:who.id,devicePublicKey:pub,
      planHash:service().configuration().planHash,mode:'conversation',sourceLanguage:'zh',targetLanguage:'en',voiceOutput:true,issuedAtMs:now};
    const data=Buffer.from(JSON.stringify(body));
    return {clientData:data.toString('base64'),deviceSignature:sign('sha256',data,{key:key.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')};
  }
  function serving(ticket:Record<string,any>,nonce='b'.repeat(64),clock=now+1000){
    return internalProof({sessionId:ticket.sessionId,bindingHash:ticket.controlBinding.bindingHash,deploymentId:deployment,connectionNonce:nonce,issuedAtMs:clock},secret);
  }
  function stopped(ticket:Record<string,any>,seconds=12){return signGatewayStopReceipt({sessionId:ticket.sessionId,userId:actor.id,
    billableSeconds:seconds,providerClosed:true,issuedAt:now+12000},secret);}
  function wallet(id=actor.id){return f.db.prepare('SELECT available_seconds,reserved_seconds FROM usage_accounts WHERE user_id=?').get(id);}
  function usage(){return f.db.prepare("SELECT * FROM credit_ledger WHERE kind='usage'").all();}

  it('defaults closed when retained backend qualification is missing, before any reservation',async()=>{
    const closed=new V10ControlService(f.store(),{...config,qualifiedBackend:false});
    await expect(closed.issue(actor,envelope(),now)).rejects.toThrow('v10_control_not_ready');
    expect(wallet()).toMatchObject({available_seconds:100,reserved_seconds:0});
  });
  it('uses a registered attested owner key and rejects signature copying to a new request',async()=>{
    const e=envelope();const b=JSON.parse(Buffer.from(e.clientData,'base64').toString());b.requestKey='c'.repeat(64);
    await expect(service().issue(actor,{...e,clientData:Buffer.from(JSON.stringify(b)).toString('base64')},now)).rejects.toThrow('v10_request_signature');
    f.db.prepare('DELETE FROM device_permit_keys').run();
    await expect(service().issue(actor,e,now)).rejects.toThrow('v10_attested_device_required');
    expect(wallet()).toMatchObject({available_seconds:100,reserved_seconds:0});
  });
  it('replays the same exact authorization without another hold or longer expiry',async()=>{
    const e=envelope(),first=await service().issue(actor,e,now),again=await service().issue(actor,e,now+45000);
    expect(again).toEqual(first);expect(first.execution).toBe('retained_v10_processing');
    expect(first.maxDurationSeconds).toBe(100);expect(wallet()).toMatchObject({available_seconds:0,reserved_seconds:100});
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM credit_reservations').get()).toMatchObject({n:1});
    expect(first).not.toHaveProperty('supplierKey');expect(first).not.toHaveProperty('ttsEndpoint');
  });
  it('keeps admission single-use across different connection nonces',async()=>{
    const ticket=await service().issue(actor,envelope(),now),proof=serving(ticket);
    expect((await service().serving(proof,now+1000,true)).status).toBe('active');
    expect((await service().serving(proof,now+1000,true)).status).toBe('active');
    await expect(service().serving(serving(ticket,'c'.repeat(64)),now+1000,true)).rejects.toThrow();
  });
  it('enforces capacity in the hold transaction without stranding a second owner reservation',async()=>{
    await service().issue(actor,envelope(),now);const other=await owner('owner-b');
    await expect(service().issue(other.actor,envelope('c'.repeat(64),other.actor,other.keys,other.publicKey),now)).rejects.toThrow();
    expect(wallet('owner-b')).toMatchObject({available_seconds:100,reserved_seconds:0});
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM credit_reservations').get()).toMatchObject({n:1});
  });
  it('revocation blocks further serving while retaining the unsettled reservation',async()=>{
    const ticket=await service().issue(actor,envelope(),now);await service().serving(serving(ticket),now+1000,true);
    f.db.prepare('UPDATE account_tokens SET revoked_ms=? WHERE token_hash=?').run(now+2000,actor.tokenHash);
    await expect(service().serving(serving(ticket,'b'.repeat(64),now+3000),now+3000)).rejects.toThrow('v10_authorization_revoked');
    expect(wallet()).toMatchObject({available_seconds:0,reserved_seconds:100});expect(usage()).toHaveLength(0);
  });
  it('does not treat authorization expiry as proof that retained processing stopped',async()=>{
    const ticket=await service().issue(actor,envelope(),now),clock=now+1800001;
    await expect(service().serving(serving(ticket,'b'.repeat(64),clock),clock,true)).rejects.toThrow('v10_authorization_expired');
    expect(wallet()).toMatchObject({available_seconds:0,reserved_seconds:100});expect(usage()).toHaveLength(0);
  });
  it('settles only the signed processing-gateway amount and only once',async()=>{
    const ticket=await service().issue(actor,envelope(),now);await service().serving(serving(ticket),now+1000,true);
    const proof=stopped(ticket);expect((await service().finish(proof,now+13000)).consumedSeconds).toBe(12);
    expect((await service().finish(proof,now+14000)).consumedSeconds).toBe(12);
    expect(usage()).toHaveLength(1);expect(usage()[0]).toMatchObject({delta_seconds:-12,idempotency_key:'settle:'+ticket.sessionId});
    expect(wallet()).toMatchObject({available_seconds:88,reserved_seconds:0});
  });
  it('cannot settle fabricated zero seconds or cancel an admitted session',async()=>{
    const ticket=await service().issue(actor,envelope(),now);await service().serving(serving(ticket),now+1000,true);
    await expect(service().finish(stopped(ticket,0)+'x',now+13000)).rejects.toThrow('v10_stop_proof');
    await expect(service().cancel(actor,ticket.sessionId,now+13000)).rejects.toThrow('v10_stop_proof_required');
    expect(usage()).toHaveLength(0);expect(wallet()).toMatchObject({reserved_seconds:100});
  });
  it('allows trusted completion of an old obligation after logout',async()=>{
    const ticket=await service().issue(actor,envelope(),now);await service().serving(serving(ticket),now+1000,true);
    f.db.prepare('UPDATE account_tokens SET revoked_ms=? WHERE token_hash=?').run(now+2000,actor.tokenHash);
    expect((await service().finish(stopped(ticket),now+13000)).status).toBe('ended');expect(usage()).toHaveLength(1);
  });
  it('cancels only a never-admitted authorization and rejects a later start',async()=>{
    const ticket=await service().issue(actor,envelope(),now);
    expect((await service().cancel(actor,ticket.sessionId,now+1000)).status).toBe('ended');
    expect((await service().cancel(actor,ticket.sessionId,now+2000)).consumedSeconds).toBe(0);
    await expect(service().serving(serving(ticket),now+1000,true)).rejects.toThrow();
    expect(wallet()).toMatchObject({available_seconds:100,reserved_seconds:0});
  });
  it('does not release or rewrite an unrelated existing hold',async()=>{
    const more=await owner('owner-c',1000),old={sessionId:'old-unrelated-session',ownerId:more.actor.id,deploymentId:deployment,
      configurationHash:'1'.repeat(64),bindingHash:'2'.repeat(64),authTokenHash:more.actor.tokenHash,authorizationEpoch:1,captureEpoch:0,languageConfigKey:'zh->en',seconds:445};
    await new D1UsageHoldsRepository(f.store(),deployment).create(old,now);
    const before=f.db.prepare('SELECT * FROM credit_reservations WHERE session_id=?').get(old.sessionId);
    await service().issue(more.actor,envelope('c'.repeat(64),more.actor,more.keys,more.publicKey),now);
    expect(f.db.prepare('SELECT * FROM credit_reservations WHERE session_id=?').get(old.sessionId)).toEqual(before);
    expect(wallet(more.actor.id)).toMatchObject({available_seconds:0,reserved_seconds:1000});
  });
});
