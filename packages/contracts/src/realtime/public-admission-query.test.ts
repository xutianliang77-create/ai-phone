import {describe,it,expect} from "vitest";
import {isPublicAdmissionQuery,matchesPublicAdmissionReceipt,type PublicAdmissionQuery} from "./public-admission-query.js";
const query=():PublicAdmissionQuery=>({contractVersion:1,requestId:"nonce",sessionId:"session",ownerId:"owner",deploymentId:"deployment",modelPolicyRevision:"policy",grantRef:"grant",purpose:"connect",
  leaseId:"lease",captureId:"capture",languagePolicyKey:"language",sampleRate:16000,configurationRevision:1,configurationHash:"a".repeat(64)});
describe("read-only admission query contract",()=>{
  it("accepts only an exact scoped query and nonce-matched receipt",()=>{
    const q=query();expect(isPublicAdmissionQuery(q)).toBe(true);expect(matchesPublicAdmissionReceipt({...q,allowed:true,checkedAt:new Date(1000).toISOString(),expiresAt:new Date(10000).toISOString(),maxActiveSeconds:60,status:"created"},q,1000)).toBe(true);
  });
  it.each([null,[],{},"query",{...query(),contractVersion:2},{...query(),apiKey:"forged"},{...query(),requestId:""},{...query(),ownerId:"bad\nowner"},
    {...query(),sampleRate:48000},{...query(),configurationRevision:0},{...query(),configurationHash:"bad"},{...query(),purpose:"resume"}])("rejects malformed query %j",value=>expect(isPublicAdmissionQuery(value)).toBe(false));
  it("does not consider a connect ACK a dispatch permission",()=>{
    const q=query(),r={...q,allowed:true,checkedAt:new Date(1000).toISOString(),expiresAt:new Date(10000).toISOString(),maxActiveSeconds:60,status:"created"};
    expect(matchesPublicAdmissionReceipt(r,{...q,purpose:"dispatch"},1000)).toBe(false);expect(matchesPublicAdmissionReceipt({...r,requestId:"old"},q,1000)).toBe(false);
  });
  it("matches a read-only recovery checkpoint but never accepts it as connect or dispatch permission",()=>{
    const q:PublicAdmissionQuery={...query(),purpose:"recovery"},r={...q,allowed:true,status:"paused",checkedAt:new Date(1000).toISOString(),expiresAt:new Date(10000).toISOString(),maxActiveSeconds:60,
      recovery:{runtimeSequence:2,lastAcceptedSample:3200,finalRevision:1,activeMs:1000,recoveryUntil:new Date(9000).toISOString()}};
    expect(isPublicAdmissionQuery(q)).toBe(true);expect(matchesPublicAdmissionReceipt(r,q,1000)).toBe(true);
    expect(matchesPublicAdmissionReceipt(r,{...q,purpose:"connect"},1000)).toBe(false);expect(matchesPublicAdmissionReceipt(r,{...q,purpose:"dispatch"},1000)).toBe(false);
    expect(isPublicAdmissionQuery({...q,recovery:r.recovery})).toBe(false);
  });
  it.each(["missing","extra","zeroSequence","negativeSample","fractionalRevision","spent","expired","beyondLease","wrongNonce"])("rejects invalid recovery %s",kind=>{
    const q:PublicAdmissionQuery={...query(),purpose:"recovery"},r:any={...q,allowed:true,status:"paused",checkedAt:new Date(1000).toISOString(),expiresAt:new Date(10000).toISOString(),maxActiveSeconds:60,
      recovery:{runtimeSequence:2,lastAcceptedSample:3200,finalRevision:1,activeMs:1000,recoveryUntil:new Date(9000).toISOString()}};
    if(kind==="missing")delete r.recovery;if(kind==="extra")r.recovery.ownerId="other";if(kind==="zeroSequence")r.recovery.runtimeSequence=0;
    if(kind==="negativeSample")r.recovery.lastAcceptedSample=-1;if(kind==="fractionalRevision")r.recovery.finalRevision=.5;if(kind==="spent")r.recovery.activeMs=60000;
    if(kind==="expired")r.recovery.recoveryUntil=new Date(1000).toISOString();if(kind==="beyondLease")r.recovery.recoveryUntil=new Date(11000).toISOString();if(kind==="wrongNonce")r.requestId="old";
    expect(matchesPublicAdmissionReceipt(r,q,1000)).toBe(false);
  });
});
