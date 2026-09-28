import {createHash,randomUUID} from "node:crypto";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {Pool} from "pg";
import {expect,it,vi} from "vitest";
import type {FastifyInstance} from "fastify";
import {buildApp} from "../../app.js";
import {buildPostgresPrimaryPoolConfig} from "../../infrastructure/storage/postgres-projection-config.js";
import {expectedPostgresMigrations} from "../../infrastructure/storage/postgres-schema-manifest.js";
import {signPostgresCutoverEvidence} from "../../infrastructure/storage/postgres-primary-startup.js";
import {initializeRepositoryRuntime,type RepositoryRuntime} from "../../infrastructure/storage/repository-runtime.js";
import {createSession,findSession} from "../sessions/sessions-runtime.repository.js";
import type {SessionRecord} from "../sessions/session-record.js";
import {createUsageHold} from "../usage/usage-hold-runtime.service.js";
import {ensureTestAccount} from "../account/account-runtime.service.js";
import {issuePublicRuntimeLease,publicProcessingHash} from "../sessions/public-runtime-admission.js";
import {recordPublicInferenceEvidence,writePublicInferenceAdmission} from "../sessions/public-inference-admission.service.js";
import {deviceSpeakerProfile,type AudioFrame,type ServerRealtimeEvent} from "@translation/contracts";
import {LmStudioRealtimeProvider} from "../../../../realtime-gateway/src/providers/lmstudio/lmstudio-realtime-provider.js";
import {DeviceSpeakerAttributionProvider} from "../../../../realtime-gateway/src/speaker/device-speaker-attribution-provider.js";
import {DeviceSpeakerTimeline} from "../../../../realtime-gateway/src/speaker/device-speaker-timeline.js";
import {SpeakerAwareAsrProvider} from "../../../../realtime-gateway/src/asr/speaker-aware-asr-provider.js";
import {createSessionEventSink,bindPublicSessionEventSink} from "../../../../realtime-gateway/src/sessions/session-event-sink.js";
import type {RealtimeEnv} from "../../../../realtime-gateway/src/config/env.js";
import {RealtimeEventDispatcher} from "../../../../realtime-gateway/src/connection/realtime-event-dispatcher.js";
import {RealtimeSessionFinalizer} from "../../../../realtime-gateway/src/connection/realtime-session-finalizer.js";
import {RealtimeFlushTracker} from "../../../../realtime-gateway/src/connection/realtime-flush-tracker.js";
import {flushProviderSession} from "../../../../realtime-gateway/src/connection/session-control-handler.js";
import {createSession as createGatewaySession,deleteSession} from "../../../../realtime-gateway/src/sessions/session-manager.js";
import {loopbackFetch} from "./public-segment-http.test-support.js";

// An explicitly owned, migrated empty DB is prepared externally. Never target QA.
const configFile=process.env.PERSISTENCE_PG_CONFIG;
it.skipIf(!configFile)("persists Gateway retirement/restoration and frozen stop metering over HTTP/PG, then cold-reads history",async()=>{
  const config=JSON.parse(readFileSync(configFile!,"utf8")),url=new URL(config.url),dir=dirname(configFile!);
  const database=config.database;
  if(!["wujie_co11_segments_probe_20260928","wujie_co11_review_probe_20260928"].includes(database))throw Error("not an owned fixture name");
  const port=process.env.PERSISTENCE_PG_LOCAL_CONTAINER==="true"?"15486":"15596";
  if(url.hostname!=="127.0.0.1"||url.port!==port||url.pathname!==`/${database}`||config.database!==database)throw Error("not the owned isolated database");
  const start=Date.now(),id=`co11-segment-${randomUUID()}`,clock=(s:number)=>vi.setSystemTime(start+s*1000);
  let runtime:RepositoryRuntime|undefined,app:FastifyInstance|undefined;
  const originalFetch=loopbackFetch;
  try{
    vi.stubEnv("NODE_ENV","development");vi.stubEnv("VITEST",undefined);
    for(const [key,value]of Object.entries({API_STORAGE_DRIVER:"postgres",POSTGRES_PRIMARY_ENABLED:"true",POSTGRES_PROJECTION_ENABLED:"false",
      POSTGRES_URL:config.url,POSTGRES_SSL_MODE:"verify-full",POSTGRES_SSL_ROOT_CERT_FILE:join(dir,"pg-root.crt"),
      PLATFORM_INSTANCE_ID:"co11-segment-persistence-probe",POSTGRES_CUTOVER_ID:"co11-segment-empty-fixture",
      POSTGRES_CUTOVER_EVIDENCE_HMAC_KEY:"isolated-test-only-not-production-signing-key",POSTGRES_CUTOVER_EVIDENCE_FILE:join(dir,"empty-db-evidence.json"),
      API_RESULT_SYNC_DEPLOYMENT_ID:"public-test",INTERNAL_API_SECRET:"internal-test-secret-123",API_TEST_AUTO_ACCOUNT:"true",LOG_LEVEL:"error"}))vi.stubEnv(key,value);
    const probe=new Pool(buildPostgresPrimaryPoolConfig());
    try{
      const identity=(await probe.query("SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid")).rows[0];
      expect(identity.name).toBe(database);
      const tls=(await probe.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()")).rows[0];expect(tls.ssl).toBe(true);
      if(!existsSync(process.env.POSTGRES_CUTOVER_EVIDENCE_FILE!)){
        const rows=(await probe.query("SELECT namespace,record_key,payload FROM ai_phone.projection_records ORDER BY namespace,record_key")).rows;
        expect(rows).toEqual([]);const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
        const applied=(await probe.query("SELECT version FROM ai_phone.schema_migrations ORDER BY version")).rows.map(r=>r.version);
        expect(applied).toEqual([...expectedPostgresMigrations]);
        const evidence={formatVersion:1,status:"matched",cutoverId:process.env.POSTGRES_CUTOVER_ID,localHash:hash([]),postgresHash:hash(rows),
          schema:{expected:[...expectedPostgresMigrations],applied},normalized:{issues:[]},database:identity,purpose:"owned empty synthetic fixture, not production cutover"};
        writeFileSync(process.env.POSTGRES_CUTOVER_EVIDENCE_FILE!,JSON.stringify({...evidence,signature:signPostgresCutoverEvidence(evidence)}),{flag:"wx",mode:0o600});
      }
    }finally{await probe.end();}
    runtime=await initializeRepositoryRuntime();expect(runtime.driver).toBe("postgres");console.info("PG fixture: runtime ready");
    vi.useFakeTimers({toFake:["Date"]});clock(0);
    await ensureTestAccount();await createSession(record(id,start));
    const lease=await qualify(id,start);
    const held=await createUsageHold("guest-user",30,{sessionId:id,idempotencyKey:`hold:${id}`});expect(held.status).toBe("held");console.info("PG fixture: held");
    app=await buildApp();
    app.addHook("onRequest",(request,_reply,done)=>{console.info("PG fixture incoming",request.url);done();});
    const origin=await app.listen({host:"127.0.0.1",port:0});
    const calls:Array<{path:string;body:unknown;status:number}>=[];
    // Actual loopback HTTP transport, not app.inject or canned API responses.
    // HTTPS admission syntax is retained; this fixture does not re-qualify API TLS.
    const transport:typeof fetch=async(input,init)=>{
      const target=new URL(String(input));expect(target.origin).toBe("https://synthetic-api.test");
      console.info("PG fixture request",target.pathname);
      const response=await originalFetch(origin+target.pathname,init);
      console.info("PG fixture response",target.pathname,response.status);
      calls.push({path:target.pathname,body:JSON.parse(String(init?.body)),status:response.status});return response;
    };
    const env={sessionEventSink:"api",apiBaseUrl:"https://synthetic-api.test",internalApiSecret:process.env.INTERNAL_API_SECRET,sessionSyncTimeoutMs:10000} as RealtimeEnv;
    const binding={sessionId:id,ownerId:"guest-user",deploymentId:"public-test",modelPolicyRevision:"policy-v1",...lease,sampleRate:16000 as const};
    const sink=bindPublicSessionEventSink(createSessionEventSink(env,transport),binding);
    const input={sessionId:id,sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput:false,asrEndpointMode:"conversation" as const,
      speakerAttribution:{mode:"diarization" as const,maxSpeakers:4 as const,deviceProfile:deviceSpeakerProfile.id,allowVoiceIdentity:false}};
    const originals=["会议结束以后，我会整理会议纪要。","并在下班前发给大家确认。"].map((text,i)=>({segmentId:i?"child":"parent",revision:1,isFinal:true,text,language:"zh" as const,
      timing:{startMs:i*1000,endMs:(i+1)*1000,source:"estimated" as const}}));
    let n=0,sequence=0,evidence=0;
    const base={createSession:async()=>{},closeSession:vi.fn(async()=>{}),healthCheck:async()=>true,transcribe:async()=>originals[n++]??null,flush:async()=>null};
    const device=new DeviceSpeakerAttributionProvider(id,16000),asr=new SpeakerAwareAsrProvider(base,device,undefined,undefined,{enabled:false,maxSessions:0,maxDurationMs:0,maxRecords:0});
    const provider=new LmStudioRealtimeProvider({baseUrl:"https://synthetic-model.test",model:"synthetic",timeoutMs:1000,publicSession:input,asrProvider:asr,
      deviceSpeakerReceiver:device.accept.bind(device),deviceSpeakerRefresh:p=>device.refresh(p,asr.deviceSpeakerBoundaryGuards(id)),
      translationClient:{supportsAttemptContext:true,healthCheck:async()=>true,translate:async({text})=>`Translated: ${text}`}});
    const errors:unknown[]=[],events:ServerRealtimeEvent[]=[],tracker=new RealtimeFlushTracker();let timeline:DeviceSpeakerTimeline;
    const dispatcher=new RealtimeEventDispatcher({eventSink:sink,sendClient:e=>events.push(e),afterSend:e=>{tracker.record(e);timeline?.observe(e);},onSyncError:(_e,error)=>errors.push(error)});
    timeline=new DeviceSpeakerTimeline(id,dispatcher.send,()=>provider.deviceSpeakerBoundaryGuards(id));
    const drain=async()=>{await dispatcher.drain();await sink.drain();};
    const feed=async()=>{const frame:AudioFrame={type:"audio.frame",sessionId:id,sequence:++sequence,timestampMs:Date.now(),format:"pcm16",sampleRate:16000,data:Buffer.alloc(32000).toString("base64")};
      sink.acceptAudio(frame);for await(const e of provider.sendAudio(frame))dispatcher.send(e);await drain();};
    const annotate=(a:number,b:number)=>{const event={type:"speaker.evidence" as const,sessionId:id,profile:deviceSpeakerProfile.id,modelRevision:deviceSpeakerProfile.revision,
      sampleRate:16000 as const,sequence:++evidence,throughSample:b*16,spans:[{speaker:0,startSample:a*16,endSample:b*16,confidence:.98,overlap:false}]};
      expect(provider.acceptDeviceSpeakerEvidence(event,sequence*16000)).toBe(true);timeline.accept(event);};
    createGatewaySession({sessionId:id,userId:"guest-user",sourceLanguage:"zh",targetLanguage:"en",voiceOutput:false,planCode:"free",maxDurationSeconds:120,issuedAt:0,expiresAt:9999999999});
    await provider.createSession(input);dispatcher.send({type:"session.started",sessionId:id});await drain();
    clock(1);await feed();annotate(0,1000);await drain();expect((await findSession(id))!.segments[0].speakerRevision).toBe(1);
    await flushProviderSession(provider,id,dispatcher.send,{reason:"audio_boundary",failOnError:true});await drain();
    clock(2);await feed();annotate(1000,2000);await drain();clock(3);await feed();
    expect(errors).toEqual([]);expect((await findSession(id))!.segments).toHaveLength(1);
    expect((await findSession(id))!.segments[0]).toMatchObject({id:"parent",revision:2,timing:{startMs:0,endMs:2000}});
    expect(events).toContainEqual(expect.objectContaining({type:"transcript.final",segmentId:"child",text:"",revision:2}));
    for(const event of [{...originals[1],type:"transcript.final" as const,sessionId:id},
      {type:"translation.final" as const,sessionId:id,segmentId:"child",revision:1,text:"stale MT",language:"en" as const},
      {type:"speaker.updated" as const,sessionId:id,segmentId:"child",revision:1,speakerRevision:999,speaker:{speakerId:"device-speaker-2",role:"speaker" as const,source:"diarization" as const}}])dispatcher.send(event);
    await drain();expect((await findSession(id))!.segments).toHaveLength(1);
    // Correcting the original child invalidates the semantic grouping. The
    // ORIGINAL Provider re-emits both captions at a higher revision.
    n=originals.length;originals.push({...originals[1],revision:2,text:"这是另外一个独立的陈述。"});
    clock(4);await feed();await drain();
    const restored=(await findSession(id))!.segments.find(s=>s.id==="child")!;
    expect(restored).toMatchObject({revision:3,sourceText:"这是另外一个独立的陈述。",translatedText:"Translated: 这是另外一个独立的陈述。"});
    dispatcher.send({type:"speaker.updated",sessionId:id,segmentId:"child",revision:3,speakerRevision:1,
      speaker:{speakerId:"device-speaker-2",role:"speaker",source:"diarization"},timing:{startMs:1000,endMs:2100,source:"estimated"}});
    await drain();expect((await findSession(id))!.segments.find(s=>s.id==="child")).toMatchObject({speaker:{speakerId:"device-speaker-2"},timing:{endMs:2100}});
    const originalFlush=provider.flushSession.bind(provider);
    provider.flushSession=async function*(sessionId,options){clock(34);yield* originalFlush(sessionId,options);};
    clock(30);const finalizer=new RealtimeSessionFinalizer({sessionId:id,provider,flushTracker:tracker,audioBatcher:{stopAccepting:vi.fn(),flush:async()=>{}},
      send:dispatcher.send,drainSessionSync:drain,onError:(_s,e)=>errors.push(e),confirmed:{beforeFlush:()=>sink.confirmAudio(),freezeMeter:()=>sink.freezeMeter(),stopUncertain:()=>sink.stopUncertain()}});
    await Promise.all([finalizer.finalize("client_request"),finalizer.finalize("client_request")]);expect(errors).toEqual([]);
    const history=await(await originalFetch(`${origin}/sessions/${id}`)).json();expect(history.segments).toHaveLength(2);
    expect(history.segments.find((s:{id:string})=>s.id==="child")).toMatchObject({revision:3,translatedText:"Translated: 这是另外一个独立的陈述。",timing:{endMs:2100}});
    expect((await findSession(id))!.publicRuntime?.finalRevisions?.child).toBe(3);
    expect((await findSession(id))!.publicRuntime?.activeMs).toBe(30000);
    // Close both API and repository pool; a fresh runtime must read the same DB result.
    await app.close();app=undefined;await runtime.close();runtime=undefined;
    runtime=await initializeRepositoryRuntime();app=await buildApp();const newOrigin=await app.listen({host:"127.0.0.1",port:0});
    const reread=await(await originalFetch(`${newOrigin}/sessions/${id}`)).json();expect(reread).toEqual(history);
    expect((await findSession(id))!.retiredSegmentRevisions).toEqual({child:2});
    const sealed=await originalFetch(`${newOrigin}/internal/realtime/segments`,{method:"POST",headers:{authorization:`Bearer ${env.internalApiSecret}`,"content-type":"application/json"},body:JSON.stringify({sessionId:id,segmentId:"parent",revision:3,retired:true})});expect(sealed.status).toBe(409);
    if(runtime.driver!=="postgres")throw Error("postgres runtime lost");
    const ledger=(await runtime.postgres.pool.query("SELECT delta_seconds FROM ai_phone.billing_ledger_entries WHERE session_id=$1",[id])).rows;
    expect(ledger).toEqual([{delta_seconds:-30}]);expect(base.closeSession).toHaveBeenCalledOnce();
    if(process.env.PERSISTENCE_WIRE_OUTPUT)writeFileSync(process.env.PERSISTENCE_WIRE_OUTPUT,JSON.stringify({formatVersion:1,
      provenance:"actual Gateway events and HTTP/PostgreSQL API history; synthetic ASR/MT, no model call",events,history,reread,calls,ledger},null,2)+"\n",{flag:"wx",mode:0o600});
  }catch(error){
    console.error("PG fixture failure",error instanceof Error?error.message.replace(config.url,"[isolated-db]"):"unknown");
    throw error;
  }finally{
    deleteSession(id);await app?.close();await runtime?.close();vi.useRealTimers();vi.unstubAllEnvs();
  }
},90_000);

function record(id:string,start:number):SessionRecord{return {id,userId:"guest-user",mode:"conversation",status:"created",consumedSeconds:0,
  createdAt:new Date(start).toISOString(),segments:[],processingDeploymentId:"public-test",
  processingAuthorization:{contractVersion:1,processingMode:"online",modelPolicyRevision:"policy-v1",publicGrantRef:"integration-grant",
    languagePolicy:{source:"zh",target:"en",autoReverse:false,revision:1},syncPermission:{allowed:false},executionPlan:{
      asr:{execution:"public",scopeKey:"asr",reason:"online_selected"},translation:{execution:"public",scopeKey:"mt",reason:"online_selected"},tts:{execution:"disabled"}}}};}
async function qualify(id:string,start:number){
  const prepared=(await findSession(id))!,common={sessionId:id,ownerId:"guest-user",deploymentId:"public-test",processingHash:publicProcessingHash(prepared),
    region:"synthetic-region",providerPolicyRevision:"synthetic-policy",sourceReceiptId:"synthetic-source",issuedAt:new Date(start).toISOString(),expiresAt:new Date(start+3600000).toISOString()};
  await recordPublicInferenceEvidence(id,"guest-user",{...common,id:"synthetic-consent",kind:"inference_consent",version:"public-inference-v1",components:["asr","translation"]});
  await recordPublicInferenceEvidence(id,"guest-user",{...common,id:"synthetic-budget",kind:"provider_budget",state:"reserved",currency:"CNY",reservedMicros:100,maxActiveSeconds:120,sampleRate:16000});
  for(const component of ["asr","translation"] as const)await recordPublicInferenceEvidence(id,"guest-user",{...common,id:`synthetic-${component}`,kind:"model_qualification",state:"qualified",component,
    scopeKey:prepared.processingAuthorization!.executionPlan[component].scopeKey,providerId:"synthetic-provider",modelId:`synthetic-${component}`});
  await writePublicInferenceAdmission(id,"guest-user",{consentReceiptId:"synthetic-consent",budgetReservationId:"synthetic-budget",qualificationReceiptIds:{asr:"synthetic-asr",translation:"synthetic-translation"}});
  return issuePublicRuntimeLease(id,"guest-user");
}
