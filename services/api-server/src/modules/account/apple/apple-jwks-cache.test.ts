import {generateKeyPairSync,sign} from "node:crypto";
import {describe,it,expect} from "vitest";
import {AppleIdentityVerifier,AppleJwksCache} from "./apple-identity.js";

describe("Apple public key cache across request-scoped verifiers",()=>{
  const now=1_800_000_000_000;
  function fixture(){
    const keys=generateKeyPairSync("rsa",{modulusLength:2048});let calls=0,kid="one";
    const cache=new AppleJwksCache();
    const fetchFn:typeof fetch=async()=>{calls++;return Response.json({keys:[{...keys.publicKey.export({format:"jwk"}),kid,use:"sig",alg:"RS256"}]});};
    function token(at=now,nonce="expected",keyId=kid){
      const h=Buffer.from(JSON.stringify({alg:"RS256",kid:keyId})).toString("base64url");
      const b=Buffer.from(JSON.stringify({iss:"https://appleid.apple.com",aud:"test.bundle",sub:"synthetic",nonce,
        iat:Math.floor(at/1000),exp:Math.floor(at/1000)+3600})).toString("base64url");
      return `${h}.${b}.${sign("sha256",Buffer.from(`${h}.${b}`),keys.privateKey).toString("base64url")}`;
    }
    return {verifier:()=>new AppleIdentityVerifier("test.bundle","TEAM",fetchFn,cache),token,
      calls:()=>calls,rotate:()=>{kid="two";}};
  }
  it("reuses only keys while still checking nonce and expiry for every token",async()=>{
    const f=fixture();await f.verifier().verifyToken(f.token(),"expected",now);
    await f.verifier().verifyToken(f.token(),"expected",now+1);expect(f.calls()).toBe(1);
    await expect(f.verifier().verifyToken(f.token(),"wrong",now+2)).rejects.toThrow("nonce_mismatch");
    await expect(f.verifier().verifyToken(f.token(),"expected",now+3_600_000)).rejects.toThrow("invalid_claims");
  });
  it("refreshes unknown key ids and expired cache entries",async()=>{
    const f=fixture();await f.verifier().verifyToken(f.token(),"expected",now);f.rotate();
    await f.verifier().verifyToken(f.token(),"expected",now+1);expect(f.calls()).toBe(2);
    await f.verifier().verifyToken(f.token(now+3_600_001),"expected",now+3_600_001);expect(f.calls()).toBe(3);
  });
  it("coalesces concurrent reads and does not retain failed fetches",async()=>{
    const cache=new AppleJwksCache();let calls=0;
    let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
    const fetchFn:typeof fetch=async()=>{calls++;await gate;return Response.json({keys:[{kid:"one"}]});};
    const a=cache.read(fetchFn,now,false),b=cache.read(fetchFn,now,false);release();await Promise.all([a,b]);expect(calls).toBe(1);
    const failed=new AppleJwksCache();let failures=0;const bad:typeof fetch=async()=>{failures++;throw Error("offline fixture");};
    await expect(failed.read(bad,now,false)).rejects.toThrow();await expect(failed.read(bad,now+1,false)).rejects.toThrow();expect(failures).toBe(2);
  });
});
