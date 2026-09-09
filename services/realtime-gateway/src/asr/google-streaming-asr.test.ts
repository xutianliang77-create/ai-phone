import {afterEach,describe,expect,it,vi} from "vitest";
import type {AudioFrame,PublicModelAttemptEvent} from "@translation/contracts";
import type {HttpAsrProvider} from "./http-asr-provider.js";
import type {ConfiguredStreamingAsrOptions} from "./configured-public-asr.js";
import {ProviderRouter} from "../providers/provider-router.js";
import {markAcceptedAudioRange} from "../connection/accepted-audio-range.js";
import {SyntheticGoogleAsrStream} from "./google-streaming-asr.test-support.js";
import {createGoogleAsrStream,type GoogleAsrStreamFactory,type GoogleStreamInput} from "./google-streaming-asr.js";
import {Client} from "@grpc/grpc-js";
const active:HttpAsrProvider[]=[];
const session={sessionId:"google-asr",sourceLanguage:"en" as const,targetLanguage:"zh" as const};
function frame(n=1,rate:16000|24000=16000):AudioFrame{const f:AudioFrame={type:"audio.frame",sessionId:session.sessionId,sequence:n,timestampMs:1788883200000,format:"pcm16",sampleRate:rate,data:Buffer.alloc(rate/5).toString("base64")};markAcceptedAudioRange(f,{startSample:(n-1)*rate/10,endSample:n*rate/10});return f;}
function setup(configure?:(s:SyntheticGoogleAsrStream)=>void){
  const plan={asr:{execution:"public",reason:"online_selected",scopeKey:"asr"},translation:{execution:"public",reason:"online_selected",scopeKey:"mt"},tts:{execution:"disabled"}} as const;
  const peers:SyntheticGoogleAsrStream[]=[],record=vi.fn(async(_e:PublicModelAttemptEvent)=>{}),authorizeConnection=vi.fn(async()=>{}),resolveCredentials=vi.fn(async()=>({accessToken:"SYNTHETIC_TOKEN",accessTokenExpiresAt:Date.now()+3600000,quotaProjectId:"project"}));
  const googleStreamFactory=vi.fn((_input:GoogleStreamInput)=>{const s=new SyntheticGoogleAsrStream();configure?.(s);peers.push(s);return s.transport();});
  const options:ConfiguredStreamingAsrOptions={deploymentId:"public",sessionId:session.sessionId,leaseId:"lease",record,authorizeConnection,resolveCredentials,googleStreamFactory,
    snapshot:{deploymentId:"public",configurationRevision:1,modelPolicyRevision:"policy",executionPlan:plan,components:{asr:{enabled:true,vendor:"google",protocol:"google_speech_v2",authKind:"google_service_account",endpoint:"https://speech.googleapis.com",projectId:"project",location:"global",recognizer:"_",languageLocales:{en:"en-US",zh:"cmn-Hans-CN",fr:"fr-FR"},modelId:"long",sampleRate:16000,timeoutMs:500}}},
    authorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy",executionPlan:plan,languagePolicy:{source:"en",target:"zh",autoReverse:false,revision:1},syncPermission:{allowed:false}}};
  const create=()=>{const p=new ProviderRouter().createConfiguredStreamingAsrProvider(options);active.push(p);return p;};return {options,peers,record,authorizeConnection,resolveCredentials,googleStreamFactory,create};
}
afterEach(async()=>{for(const p of active.splice(0))await p.closeSession(session.sessionId);vi.useRealTimers();vi.restoreAllMocks();});
describe("Google v2 on original ASR lifecycle",()=>{
  it.each([16000,24000] as const)("uses %i explicit PCM config before audio and confirms trailers plus EOF",async rate=>{
    const t=setup();t.options.snapshot.components.asr!.sampleRate=rate;const p=t.create();await p.createSession(session);expect(t.googleStreamFactory).not.toHaveBeenCalled();
    await p.transcribe(frame(1,rate));expect(t.peers[0].requests[0].audio?.length??0).toBe(0);
    expect(t.peers[0].configuration).toMatchObject({recognizer:"projects/project/locations/global/recognizers/_",streamingConfig:{configMask:{paths:["*"]},config:{model:"long",languageCodes:["en-US"],explicitDecodingConfig:{sampleRateHertz:rate,audioChannelCount:1}},streamingFeatures:{interimResults:true}}});
    expect(t.peers[0].requests.slice(1).every(r=>!r.streamingConfig&&r.audio!.length<=1920)).toBe(true);
    expect(await p.flush(session.sessionId)).toMatchObject({text:"Hello world.",timing:{startMs:0,endMs:100}});
    expect(t.record.mock.calls.at(-1)![0]).toMatchObject({providerId:"google",state:"confirmed",metadata:{requestId:"google-asr-request",usage:{audioSeconds:1}}});
    expect(t.peers[0].clientClosed).toBe(true);expect(await p.healthCheck()).toBe(false);
  });
  it("uses explicit TLS metadata and does not call gax retry/auth machinery",()=>{
    const peer=new SyntheticGoogleAsrStream();const call=vi.spyOn(Client.prototype,"makeBidiStreamRequest").mockReturnValue(peer as any),close=vi.spyOn(Client.prototype,"close");
    const result=createGoogleAsrStream({target:"speech.googleapis.com:443",headers:{authorization:"Bearer SYNTHETIC","x-goog-user-project":"project"},deadline:new Date(Date.now()+1000)});
    expect(call.mock.calls[0][0]).toBe("/google.cloud.speech.v2.Speech/StreamingRecognize");expect((call.mock.calls[0][3] as any).get("authorization")).toEqual(["Bearer SYNTHETIC"]);
    result.close();expect(close).toHaveBeenCalledTimes(1);peer.cancel();
  });
  it("concatenates disjoint final portions, replacing each response's interim suffix",async()=>{
    const t=setup(s=>s.autoFinish=false),p=t.create();await p.createSession(session);const partials:string[]=[];p.setPartialListener(session.sessionId,r=>partials.push(r.text));await p.transcribe(frame());
    const peer=t.peers[0];peer.respond({results:[{alternatives:[{transcript:"Hello"}],isFinal:true,languageCode:"en-US",resultEndOffset:{nanos:40000000}},{alternatives:[{transcript:" wurld"}],languageCode:"en-US",resultEndOffset:{nanos:90000000}}]});
    const pending=p.flush(session.sessionId);await vi.waitFor(()=>expect(peer.writableEnded).toBe(true));
    peer.respond({results:[{alternatives:[{transcript:" world."}],isFinal:true,languageCode:"en-US",resultEndOffset:{nanos:100000000}}]});peer.emit("status",{code:0});peer.push(null);
    expect((await pending)?.text).toBe("Hello world.");expect(partials).toContain("Hello wurld");
  });
  it.each(["locale","source","region","project","short_model"])("rejects unbound %s before credentials",kind=>{
    const t=setup(),profile=t.options.snapshot.components.asr!;if(kind==="locale")profile.languageLocales={};if(kind==="source")profile.languageLocales={en:"fr-FR"};
    if(kind==="region")profile.location="us";if(kind==="project")profile.projectId="";if(kind==="short_model")profile.modelId="latest_short";
    expect(t.create).toThrow();expect(t.resolveCredentials).not.toHaveBeenCalled();
  });
  it.each(["expired","quota"])("rejects %s tokens without a gRPC call",async kind=>{
    const t=setup();t.resolveCredentials.mockImplementation(async()=>({accessToken:"SYNTHETIC",accessTokenExpiresAt:Date.now()+(kind==="expired"?100:3600000),quotaProjectId:kind==="quota"?"other":"project"}));
    const p=t.create();await p.createSession(session);await expect(p.transcribe(frame())).rejects.toThrow();expect(t.googleStreamFactory).not.toHaveBeenCalled();
  });
  it.each(["language","nonzero_status","missing_final"])("never confirms %s failure",async kind=>{
    const t=setup(s=>{if(kind==="nonzero_status")s.statusCode=7;else s.autoFinish=false;}),p=t.create();await p.createSession(session);await p.transcribe(frame());
    const pending=p.flush(session.sessionId),check=expect(pending).rejects.toThrow();
    if(kind!=="nonzero_status"){await vi.waitFor(()=>expect(t.peers[0].writableEnded).toBe(true));if(kind==="language")t.peers[0].respond({results:[{alternatives:[{transcript:"wrong"}],isFinal:true,languageCode:"fr-FR",resultEndOffset:{nanos:100000000}}]});
      t.peers[0].emit("status",{code:0});t.peers[0].push(null);}
    await check;expect(t.record.mock.calls.at(-1)![0].state).toBe("uncertain");expect(t.googleStreamFactory).toHaveBeenCalledTimes(1);
  });
  it("cancels without half-closing or creating another model call",async()=>{
    const t=setup(),p=t.create();await p.createSession(session);const send=p.transcribe(frame());const check=expect(send).rejects.toThrow();await vi.waitFor(()=>expect(t.peers[0]?.audioBytes).toBeGreaterThan(0));
    await p.closeSession(session.sessionId);await check;expect(t.peers[0].cancelled).toBe(true);expect(t.peers[0].writableEnded).toBe(false);expect(t.googleStreamFactory).toHaveBeenCalledTimes(1);
  });
});
