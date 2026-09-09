import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync,readFileSync} from "node:fs";
import {generateKeyPairSync,verify} from "node:crypto";
import {tmpdir} from "node:os";import {join} from "node:path";
import {emptyConfiguration} from "./public-model-config.js";
import {savePublicModelConfiguration,readPublicModelConfiguration} from "./public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration} from "./public-model-runtime-config.js";
import {createPublicModelCredentialResolver} from "./public-model-credential-resolver.js";
import {GOOGLE_TOKEN_URL,exchangeGoogleToken} from "./google-token-exchange.js";
const keys=generateKeyPairSync("rsa",{modulusLength:2048});
const account={type:"service_account",project_id:"synthetic-project",client_email:"synthetic@project.iam.gserviceaccount.com",private_key_id:"synthetic-key-id",
  private_key:keys.privateKey.export({type:"pkcs8",format:"pem"}).toString(),token_uri:GOOGLE_TOKEN_URL};
const user={type:"authorized_user",client_id:"SYNTHETIC_CLIENT",client_secret:"SYNTHETIC_SECRET",refresh_token:"SYNTHETIC_REFRESH",quota_project_id:"synthetic-quota"};
let dir:string,adc:string,clock:number;
const token=(value="SYNTHETIC_ACCESS",expires=3600)=>new Response(JSON.stringify({access_token:value,token_type:"Bearer",expires_in:expires}));
function body(revision=0,auth="google_service_account"){
  const c=emptyConfiguration("token-test");for(const component of ["asr","translation"] as const)Object.assign(c.components[component],{enabled:true,endpoint:component==="asr"?"wss://synthetic.invalid":"https://synthetic.invalid",modelId:"selected-model",timeoutMs:1000});
  Object.assign(c.components.translation,{vendor:"google",protocol:"google_vertex_gemini",authKind:auth,projectId:"synthetic-project",location:"global"});
  return {expectedRevision:revision,components:c.components,credentials:{asr:{apiKey:"SYNTHETIC_ASR"},translation:auth==="google_adc"?{}:{serviceAccountJson:JSON.stringify(account)}}};
}
beforeEach(async()=>{dir=mkdtempSync(join(tmpdir(),"wujie-google-token-"));adc=join(dir,"adc.json");clock=Date.parse("2026-09-08T00:00:00Z");
  vi.stubEnv("PUBLIC_MODEL_CONFIG_FILE",join(dir,"public.enc"));vi.stubEnv("PUBLIC_MODEL_CONFIG_KEY","ab".repeat(32));vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","token-test");
  vi.stubEnv("PUBLIC_GOOGLE_ADC_FILE",adc);vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS","/must-not-read-ambient.json");
  vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No live calls allowed"));await savePublicModelConfiguration(body());});
afterEach(()=>{expect(globalThis.fetch).not.toHaveBeenCalled();vi.restoreAllMocks();vi.unstubAllEnvs();vi.useRealTimers();rmSync(dir,{recursive:true,force:true});});
const setup=(fetchFn=vi.fn(async()=>token()))=>({fetchFn,resolve:createPublicModelCredentialResolver(capturePublicModelRuntimeConfiguration(false),"translation",{fetchFn,now:()=>clock})});
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
describe("scoped Google credential acquisition without ambient discovery",()=>{
  it("signs a real verifiable RSA assertion with fixed audience, scope and one-hour lifetime",async()=>{
    const s=setup(),result=await s.resolve();const [url,init]=(s.fetchFn.mock.calls[0] as any);
    expect(url).toBe(GOOGLE_TOKEN_URL);expect(init.redirect).toBe("error");expect(init.headers).toEqual({"content-type":"application/x-www-form-urlencoded"});
    const form=new URLSearchParams(init.body);expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header,claim,signature]=form.get("assertion")!.split(".");expect(JSON.parse(Buffer.from(header,"base64url").toString())).toMatchObject({alg:"RS256",kid:"synthetic-key-id"});
    expect(JSON.parse(Buffer.from(claim,"base64url").toString())).toEqual({iss:account.client_email,scope:"https://www.googleapis.com/auth/cloud-platform",aud:GOOGLE_TOKEN_URL,iat:clock/1000,exp:clock/1000+3600});
    expect(verify("RSA-SHA256",Buffer.from(`${header}.${claim}`),keys.publicKey,Buffer.from(signature,"base64url"))).toBe(true);
    expect(result).toEqual({accessToken:"SYNTHETIC_ACCESS",accessTokenExpiresAt:clock+3600000});
    expect(JSON.stringify(result)).not.toContain("private_key");expect(JSON.stringify(readPublicModelConfiguration())).not.toContain(account.private_key);
    expect(readFileSync(join(dir,"public.enc"),"utf8")).not.toContain("SYNTHETIC_ACCESS");
  });
  it("uses one cached token, refreshes before expiry, and never persists token bytes",async()=>{
    const s=setup();const first=await s.resolve();clock+=10000;expect(await s.resolve()).toEqual(first);expect(s.fetchFn).toHaveBeenCalledTimes(1);
    clock+=3560000;await s.resolve();expect(s.fetchFn).toHaveBeenCalledTimes(2);
  });
  it("coalesces concurrent exchanges while keeping returned token objects independent",async()=>{
    const wait=deferred<Response>(),fetchFn=vi.fn(()=>wait.promise),s=setup(fetchFn);
    const promises=[s.resolve(),s.resolve(),s.resolve()];expect(fetchFn).toHaveBeenCalledTimes(1);wait.resolve(token());
    const values=await Promise.all(promises);values[0].accessToken="mutated";expect(values[1].accessToken).toBe("SYNTHETIC_ACCESS");
    expect((await s.resolve()).accessToken).toBe("SYNTHETIC_ACCESS");
  });
  it("does not cancel another caller when one coalesced waiter cancels",async()=>{
    const wait=deferred<Response>(),fetchFn=vi.fn(()=>wait.promise),s=setup(fetchFn),cancel=new AbortController();
    const first=s.resolve(cancel.signal),second=s.resolve();const check=expect(first).rejects.toThrow("cancelled");cancel.abort();await check;
    expect((fetchFn.mock.calls[0] as any)[1].signal.aborted).toBe(false);wait.resolve(token());expect((await second).accessToken).toBe("SYNTHETIC_ACCESS");
  });
  it("aborts transport when all waiters cancel and does not cache a late result",async()=>{
    const wait=deferred<Response>(),fetchFn=vi.fn(()=>wait.promise),s=setup(fetchFn),cancel=new AbortController();
    const pending=s.resolve(cancel.signal),check=expect(pending).rejects.toThrow("cancelled");cancel.abort();await check;
    expect((fetchFn.mock.calls[0] as any)[1].signal.aborted).toBe(true);wait.resolve(token());await Promise.resolve();
    fetchFn.mockImplementation(async()=>token("SECOND_TOKEN"));expect((await s.resolve()).accessToken).toBe("SECOND_TOKEN");expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("bounds non-cooperative transport and allows a later explicit retry",async()=>{
    vi.useFakeTimers();const fetchFn=vi.fn(()=>new Promise<Response>(()=>{})),s=setup(fetchFn);
    const check=expect(s.resolve()).rejects.toThrow("cancelled");await vi.advanceTimersByTimeAsync(1001);await check;
    fetchFn.mockImplementation(async()=>token());expect((await s.resolve()).accessToken).toBe("SYNTHETIC_ACCESS");expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("bounds a stalled response body and cancels its reader",async()=>{
    vi.useFakeTimers();let cancelled=false;const fetchFn=vi.fn(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))),s=setup(fetchFn);
    const check=expect(s.resolve()).rejects.toThrow("cancelled");await vi.advanceTimersByTimeAsync(1001);await check;expect(cancelled).toBe(true);
  });
  it("does not share cache between independent deployment/session snapshot resolvers",async()=>{
    const fetchFn=vi.fn(async()=>token());await setup(fetchFn).resolve();await setup(fetchFn).resolve();expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it("refuses cached credentials and new exchanges after model revision changes",async()=>{
    const s=setup();await s.resolve();await savePublicModelConfiguration(body(1));await expect(s.resolve()).rejects.toThrow("config_changed");expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("rejects an exchange result if config changes while the request is pending",async()=>{
    const wait=deferred<Response>(),s=setup(vi.fn(()=>wait.promise)),pending=s.resolve();await savePublicModelConfiguration(body(1));wait.resolve(token());
    await expect(pending).rejects.toThrow("config_changed");
  });
  it.each(["service_account","authorized_user"])("supports explicitly configured ADC %s",async type=>{
    await savePublicModelConfiguration(body(1,"google_adc"));writeFileSync(adc,JSON.stringify(type==="service_account"?account:user),{mode:0o600});
    const s=setup();const value=await s.resolve();const form=new URLSearchParams((s.fetchFn.mock.calls[0] as any)[1].body);
    expect(form.get("grant_type")).toBe(type==="service_account"?"urn:ietf:params:oauth:grant-type:jwt-bearer":"refresh_token");
    if(type==="authorized_user"){expect(form.get("refresh_token")).toBe(user.refresh_token);expect(value.quotaProjectId).toBe("synthetic-quota");}
  });
  it("pins ADC bytes and rejects file rotation until a new resolver is intentionally bound",async()=>{
    await savePublicModelConfiguration(body(1,"google_adc"));writeFileSync(adc,JSON.stringify(user),{mode:0o600});const s=setup();await s.resolve();
    writeFileSync(adc,JSON.stringify({...user,refresh_token:"ROTATED_REFRESH"}));await expect(s.resolve()).rejects.toThrow("credentials_changed");expect(s.fetchFn).toHaveBeenCalledTimes(1);
    await setup(s.fetchFn).resolve();expect(s.fetchFn).toHaveBeenCalledTimes(2);
  });
  it.each(["missing","relative","symlink","permissions","oversize"])("refuses ADC %s and never falls back to global credentials",async kind=>{
    await savePublicModelConfiguration(body(1,"google_adc"));writeFileSync(adc,JSON.stringify(user),{mode:0o600});
    if(kind==="missing")vi.stubEnv("PUBLIC_GOOGLE_ADC_FILE","");if(kind==="relative")vi.stubEnv("PUBLIC_GOOGLE_ADC_FILE","adc.json");
    if(kind==="symlink"){const link=join(dir,"link.json");symlinkSync(adc,link);vi.stubEnv("PUBLIC_GOOGLE_ADC_FILE",link);}
    if(kind==="permissions")chmodSync(adc,0o644);if(kind==="oversize")writeFileSync(adc,"x".repeat(65537));
    const s=setup();await expect(s.resolve()).rejects.toThrow("adc_file");expect(s.fetchFn).not.toHaveBeenCalled();
  });
  it.each([{type:"external_account",credential_source:{executable:{command:"do-not-run"}}},{...account,token_uri:"https://attacker.invalid"},
    {...account,private_key:"INVALID_PRIVATE"},{...account,universe_domain:"attacker.invalid"},{...user,quota_project_id:""}])("rejects unsupported or unsafe credential data without sending it",async value=>{
    const fetchFn=vi.fn(async()=>token());await expect(exchangeGoogleToken(JSON.stringify(value),fetchFn,new AbortController().signal,()=>clock)).rejects.toThrow("public_google_");expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each([{access_token:"",token_type:"Bearer",expires_in:3600},{access_token:"LEAK\nTOKEN",token_type:"Bearer",expires_in:3600},
    {access_token:"TOKEN",token_type:"other",expires_in:3600},{access_token:"TOKEN",token_type:"Bearer",expires_in:"3600"},
    {access_token:"TOKEN",token_type:"Bearer",expires_in:7200}])("rejects malformed token responses",async value=>{
    const s=setup(vi.fn(async()=>new Response(JSON.stringify(value))));await expect(s.resolve()).rejects.toThrow("token_response_invalid");
  });
  it("rejects a lifetime too short for the configured model request and safety margin",async()=>{await expect(setup(vi.fn(async()=>token("TOKEN",10))).resolve()).rejects.toThrow("lifetime_too_short");});
  it.each([401,429,503])("does not retry HTTP %i or expose its body",async status=>{
    const s=setup(vi.fn(async()=>new Response("SENSITIVE_TOKEN_FAILURE",{status})));await expect(s.resolve()).rejects.toThrow("token_exchange_rejected");expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized response without preserving its body",async()=>{await expect(setup(vi.fn(async()=>new Response("x".repeat(65537)))).resolve()).rejects.toThrow("token_response_invalid");});
  it("honors pre-cancellation without reading credentials or invoking auth",async()=>{const s=setup(),c=new AbortController();c.abort();await expect(s.resolve(c.signal)).rejects.toThrow("cancelled");expect(s.fetchFn).not.toHaveBeenCalled();});
});
