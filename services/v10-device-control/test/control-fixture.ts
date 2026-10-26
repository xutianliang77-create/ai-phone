import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {Fixture,now} from '../../v10-cloudflare-control/test/fixture.js';
import {SubscriptionRepository} from '../src/subscription-repository.mjs';
import {DeviceLicenseService} from '../src/license-service.mjs';
import {normalizeTransaction} from '../src/subscription-policy.mjs';
import {LEASE_DOMAIN,PROFILE} from '../src/common.mjs';
import {IMPLEMENTATION_HASH} from '../src/component-profile.mjs';
export {now};
export function setup(){
 const f=new Fixture();for(const name of ['0002_http_surface.sql','0006_apple_billing_events.sql','0009_device_permits.sql','0011_device_subscriptions.sql'])f.db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const signer=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),config={deploymentId:'wujie-v10-device-fixture',bundleId:'com.example.phone',environment:'Sandbox',productId:'fixture.monthly',admissionOpen:true,signingKeyId:'fixture',signingKeyPem:signer.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
 async function owner(id:string){
  const user=f.seedUser(id),device=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=device.publicKey.export({format:'jwk'}),raw=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x!,'base64url'),Buffer.from(jwk.y!,'base64url')]);
  const actor={id,tokenHash:user.tokenHash,authorizationEpoch:1};
  f.db.prepare('INSERT INTO device_permit_keys VALUES(?,?,?,?,?,?,0,?,?)').run(createHash('sha256').update(raw).digest('hex'),id,raw.toString('base64'),'synthetic-attest-'+id,'synthetic-attest-public','synthetic-attestation-receipt',now,now);
  const transaction=normalizeTransaction({...config,transactionId:'tx-'+id,originalTransactionId:'chain-'+id,appAccountToken:user.appAccountToken,type:'Auto-Renewable Subscription',inAppOwnershipType:'PURCHASED',purchaseDate:now-1000,expiresDate:now+86400000,signedDate:now,currency:'CNY',storefront:'CHN',price:10000},config,now);
  await new SubscriptionRepository(f.store(),config).sync(actor,transaction,{},now);
  function envelope(patch:Record<string,unknown>={}){
   const body={domain:LEASE_DOMAIN,ownerId:id,deploymentId:config.deploymentId,devicePublicKey:raw.toString('base64'),requestKey:'a'.repeat(64),launchNonce:'launch-'+id,profile:PROFILE,implementationHash:IMPLEMENTATION_HASH,issuedAtMs:now,operation:'acquire',leaseId:'',sequence:0,...patch};
   const bytes=Buffer.from(JSON.stringify(body));return {clientData:bytes.toString('base64'),deviceSignature:sign('sha256',bytes,{key:device.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')};
  }
  return {actor,user,device,raw,transaction,envelope};
 }
 const subscriptions=()=>new SubscriptionRepository(f.store(),config);
 const licenses=()=>new DeviceLicenseService(f.store(),config,subscriptions());
 const count=(table:string)=>{if(!/^[a-z0-9_]+$/.test(table))throw Error('fixture_name');return Number(f.db.prepare('SELECT COUNT(*) n FROM '+table).get()?.n);};
 return {f,config,signer,owner,subscriptions,licenses,count};
}
