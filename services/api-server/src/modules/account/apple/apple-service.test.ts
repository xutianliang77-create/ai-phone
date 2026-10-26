import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SqliteSnapshotStore} from '../../../infrastructure/storage/sqlite-snapshot-store.js';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {SelfHostedAppleService,appleTokenHash,type AppleLoginInput} from './apple-service.js';
import {AppleIdentityError,AppleIdentityVerifier} from './apple-identity.js';
import {AppleOAuthClient} from './apple-oauth.js';
import {getStoreSnapshot,createEmptyStoreSnapshot} from '../../../infrastructure/storage/json-store.js';
import {readAppleState} from './apple-state.js';
import {logout,accountFromAuthorization} from '../account.service.js';
import {authSessionHashIsActive} from '../auth-session-binding.js';
const now=Date.parse('2026-10-26T00:00:00Z');
const settings={deploymentId:'fixture-v10-api',origin:'https://fixture.publisher.cn',clientId:'cn.qkxy.wujieai.public',teamId:'5YR3BKMQ62',keyId:'fixture-key',privateKeyPem:'synthetic-no-network',
 tokenSecret:'synthetic-test-only-account-token-secret',credentialKey:Buffer.alloc(32,7),privacyVersion:'fixture-privacy',termsVersion:'fixture-terms'};
const identity={issuer:'https://appleid.apple.com' as const,audience:settings.clientId,scope:settings.teamId+':'+settings.clientId,subjectHash:'a'.repeat(64),identityKey:'b'.repeat(64),verifiedAtMs:now,expiresMs:now+300000};
describe('self hosted Apple control; original account/session/ledger store',()=>{
 let service:SelfHostedAppleService,exchange:ReturnType<typeof vi.fn>,refresh:ReturnType<typeof vi.fn>,revoke:ReturnType<typeof vi.fn>,verify:ReturnType<typeof vi.fn>;
 beforeEach(()=>{
  Object.assign(getStoreSnapshot(),createEmptyStoreSnapshot());vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('AUTH_PROVIDER','phone');
  exchange=vi.fn().mockResolvedValue({idToken:'verified-by-fixture',refreshToken:'synthetic-sensitive-refresh'});
  refresh=vi.fn().mockResolvedValue({idToken:'verified-by-fixture'});revoke=vi.fn().mockResolvedValue(undefined);verify=vi.fn().mockResolvedValue(identity);
  service=new SelfHostedAppleService(settings,{verifier:{scope:identity.scope,verifyToken:verify} as unknown as AppleIdentityVerifier,
   oauth:{clientId:settings.clientId,exchange,refresh,revoke} as unknown as AppleOAuthClient});
 });
 afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
 async function input():Promise<AppleLoginInput>{const c=await service.begin('fixture-client',now);return {...c,identityToken:'synthetic-id-token',authorizationCode:'one-use-code',
  agreements:{privacyAccepted:true,termsAccepted:true,privacyVersion:settings.privacyVersion,termsVersion:settings.termsVersion}};}
 it('persists a five minute hash-bound challenge, not its binding secret',async()=>{
  const i=await input(),raw=JSON.stringify(getStoreSnapshot());expect(raw).not.toContain(i.bindingSecret);expect(raw).not.toContain(i.state);
  expect((await readAppleState(service.scope)).challenges[i.challengeId].expiresMs).toBe(now+300000);
 });
 it('atomically creates one original account and hashed session without granting any seconds',async()=>{
  const i=await input(),r=await service.login(i,now);const store=getStoreSnapshot();
  expect(store.accounts).toHaveLength(1);expect(store.authSessions).toHaveLength(1);expect(store.accountConsentRecords).toHaveLength(1);
  expect(store.authSessions[0].token).toBe('hash-v1:'+appleTokenHash(r.token));expect(JSON.stringify(store)).not.toContain(r.token);
  expect(JSON.stringify(store)).not.toContain('synthetic-sensitive-refresh');expect(store.billingLedger).toHaveLength(0);expect(store.usageBalances).toEqual({});
  expect(await service.authorizeHash(appleTokenHash(r.token),now)).toMatchObject({id:r.account.id});
  expect(accountFromAuthorization('Bearer '+r.token)?.id).toBe(r.account.id);
  expect(await authSessionHashIsActive(appleTokenHash(r.token),r.account.id)).toBe(true);
 });
 it('replays an exact completed submission with the original token and expiration, once-only code exchange',async()=>{
  const i=await input(),first=await service.login(i,now),again=await service.login(i,now+1000);expect(again).toEqual(first);expect(exchange).toHaveBeenCalledTimes(1);
  expect(getStoreSnapshot().authSessions).toHaveLength(1);expect(getStoreSnapshot().accountConsentRecords).toHaveLength(1);
 });
 it.each(['state','bindingSecret','deploymentId'])('rejects changed %s before external code use',async field=>{
  const i=await input();await expect(service.login({...i,[field]:'wrong'},now)).rejects.toThrow();expect(exchange).not.toHaveBeenCalled();
 });
 it('rejects forged or expired identity tokens and an invalid agreement before exchange',async()=>{
  const i=await input();verify.mockRejectedValueOnce(new AppleIdentityError('apple_invalid_signature'));
  await expect(service.login(i,now)).rejects.toThrow('apple_invalid_signature');expect(exchange).not.toHaveBeenCalled();
  await expect(service.login({...i,agreements:{...i.agreements,privacyAccepted:'true' as unknown as boolean}},now)).rejects.toThrow('account_agreements_required');
 });
 it('persists unknown exchange outcomes and never automatically consumes the code again, including after restart',async()=>{
  const i=await input();exchange.mockRejectedValueOnce(new AppleIdentityError('apple_oauth_uncertain'));
  await expect(service.login(i,now)).rejects.toThrow('apple_oauth_uncertain');
  const restart=new SelfHostedAppleService(settings,{verifier:service.verifier,oauth:service.oauth});
  await expect(restart.login(i,now+1000)).rejects.toThrow('apple_exchange_requires_fresh_signin');expect(exchange).toHaveBeenCalledTimes(1);
  expect(getStoreSnapshot().accounts).toHaveLength(0);
 });
 it('rejects a different replay and concurrent dispatch of the same one-use code',async()=>{
  const i=await input(),both=await Promise.allSettled([service.login(i,now),service.login(i,now)]);
  expect(both.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(exchange).toHaveBeenCalledTimes(1);
  await expect(service.login({...i,authorizationCode:'different'},now)).rejects.toThrow('apple_signin_conflict');
 });
 it('keeps logout revoked when an earlier successful login response is replayed',async()=>{
  const i=await input(),r=await service.login(i,now);logout('Bearer '+r.token);
  expect(await service.authorizeHash(appleTokenHash(r.token),now)).toBeNull();
  await expect(service.login(i,now+1000)).rejects.toThrow('apple_login_revoked');
  expect(await authSessionHashIsActive(appleTokenHash(r.token),r.account.id)).toBe(false);
 });
 it('blocks account deletion immediately and retains pending upstream revocation without pretending it is completed',async()=>{
  const i=await input(),r=await service.login(i,now);revoke.mockRejectedValueOnce(new Error('synthetic timeout'));
  const d=await service.requestDeletion(appleTokenHash(r.token),now+1000);expect(d.account.status).toBe('deletion_requested');expect(d.revocationStatus).toBe('pending');
  expect(await service.authorizeHash(appleTokenHash(r.token),now+2000)).toBeNull();
  expect(await service.processDeletion(r.account.id,now+3000)).toBe('confirmed');expect(revoke).toHaveBeenCalledTimes(2);
  expect(getStoreSnapshot().billingLedger).toHaveLength(0);
 });
 it('periodically revalidates upstream credentials and revokes the original sessions after invalid_grant',async()=>{
  const r=await service.login(await input(),now);refresh.mockRejectedValueOnce(new AppleIdentityError('apple_credential_revoked'));
  expect(await service.authorizeHash(appleTokenHash(r.token),now+86400001)).toBeNull();expect(refresh).toHaveBeenCalledTimes(1);
  expect(getStoreSnapshot().authSessions[0].revokedAt).toBeTruthy();
 });
 it('rejects expired challenges and bounds new challenge traffic',async()=>{
  const i=await input();await expect(service.login(i,now+300000)).rejects.toThrow('apple_challenge_unavailable');
  for(let n=1;n<10;n++)await service.begin('fixture-client',now);
  await expect(service.begin('fixture-client',now)).rejects.toThrow('apple_challenge_rate_limited');
 });
 it('preserves unrelated legacy account, historical data, reservation and ledger',async()=>{
  const store=getStoreSnapshot();store.accounts.push({id:'old-user',phoneHash:'legacy',phoneMasked:'138****0000',status:'active',createdAt:'old',updatedAt:'old'});
  store.usageBalances['old-user']=445;const before=JSON.stringify({account:store.accounts[0],balance:store.usageBalances['old-user']});
  await service.login(await input(),now);expect(JSON.stringify({account:store.accounts[0],balance:store.usageBalances['old-user']})).toBe(before);
 });
 it('retains unknown refresh outcomes until a fresh sign-in instead of repeating refresh',async()=>{
  const r=await service.login(await input(),now);refresh.mockRejectedValueOnce(new AppleIdentityError('apple_oauth_uncertain'));
  await expect(service.authorizeHash(appleTokenHash(r.token),now+86400001)).rejects.toThrow('apple_oauth_uncertain');
  await expect(service.authorizeHash(appleTokenHash(r.token),now+86500001)).rejects.toThrow('apple_refresh_requires_fresh_signin');expect(refresh).toHaveBeenCalledTimes(1);
 });
 it('backs up and restores new Apple metadata, original accounts and hashed sessions without exporting plaintext refresh credentials',async()=>{
  await service.login(await input(),now);const folder=mkdtempSync(join(tmpdir(),'wujie-apple-sqlite-'));
  const source=new SqliteSnapshotStore(join(folder,'source.sqlite'),createEmptyStoreSnapshot());let restored:SqliteSnapshotStore|undefined;
  try{
   source.save(getStoreSnapshot());await source.backupTo(join(folder,'restored.sqlite'));
   restored=new SqliteSnapshotStore(join(folder,'restored.sqlite'),createEmptyStoreSnapshot());const state=restored.read();
   expect(state.accounts).toEqual(getStoreSnapshot().accounts);expect(state.authSessions).toEqual(getStoreSnapshot().authSessions);expect(state.appleAuthStates).toEqual(getStoreSnapshot().appleAuthStates);
   expect(readFileSync(join(folder,'restored.sqlite')).includes(Buffer.from('synthetic-sensitive-refresh'))).toBe(false);
  }finally{source.close();restored?.close();rmSync(folder,{recursive:true,force:true});}
 });

});
