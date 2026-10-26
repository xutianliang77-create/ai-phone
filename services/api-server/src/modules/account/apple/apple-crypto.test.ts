import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {AppleIdentityVerifier} from './apple-identity.js';
import {appleClientSecret,AppleOAuthClient} from './apple-oauth.js';
const now=Date.parse('2026-10-26T00:00:00Z');
describe('reused Apple crypto and bounded transport',()=>{
 it('produces a five minute P-256 client secret with raw JOSE signature',()=>{
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),token=appleClientSecret({teamId:'SYNTHETIC',clientId:'fixture.bundle',keyId:'fixture',privateKeyPem:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()},now);
  const [h,b,s]=token.split('.'),payload=JSON.parse(Buffer.from(b,'base64url').toString());
  expect(payload).toMatchObject({iss:'SYNTHETIC',sub:'fixture.bundle',aud:'https://appleid.apple.com'});expect(payload.exp-payload.iat).toBe(300);
  expect(Buffer.from(s,'base64url')).toHaveLength(64);expect(verify('sha256',Buffer.from(h+'.'+b),{key:keys.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url'))).toBe(true);
 });
 it('accepts ES256 identity signatures and rejects suffixes and token-directed key fetching',async()=>{
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});let calls=0;
  const f:typeof fetch=async url=>{expect(String(url)).toBe('https://appleid.apple.com/auth/keys');calls++;return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'fixture',alg:'ES256',use:'sig'}]});};
  const verifier=new AppleIdentityVerifier('fixture.bundle','SYNTHETIC',f),payload=Buffer.from(JSON.stringify({iss:'https://appleid.apple.com',aud:'fixture.bundle',sub:'synthetic',nonce:'n',iat:now/1000,exp:now/1000+300})).toString('base64url');
  function token(extra={}){const h=Buffer.from(JSON.stringify({alg:'ES256',kid:'fixture',...extra})).toString('base64url'),b=h+'.'+payload;return b+'.'+sign('sha256',Buffer.from(b),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');}
  expect((await verifier.verifyToken(token(),'n',now)).audience).toBe('fixture.bundle');
  await expect(verifier.verifyToken(token()+'.suffix','n',now)).rejects.toThrow('invalid_jwt');
  await expect(verifier.verifyToken(token({jku:'https://attacker.invalid/keys'}),'n',now)).rejects.toThrow('invalid_jwt_header');expect(calls).toBe(1);
 });
 it('never retries a one-use OAuth code and sanitizes rejected provider bodies',async()=>{
  let calls=0;const f:typeof fetch=async(url,init)=>{calls++;expect(String(url)).toBe('https://appleid.apple.com/auth/token');expect(init?.redirect).toBe('error');
   return Response.json({error:'invalid_grant',sensitive:'must-not-be-returned'},{status:400});};
  const oauth=new AppleOAuthClient('fixture.bundle',async()=>'fixture-client-secret',f);
  await expect(oauth.exchange('one-use-code')).rejects.toThrow('apple_credential_revoked');expect(calls).toBe(1);
 });
});
