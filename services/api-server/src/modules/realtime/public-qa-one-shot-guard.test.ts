import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {publicQaOneShotGuardFromEnvironment} from "./public-qa-one-shot-guard.js";

const fake=vi.hoisted(()=>({records:new Map<string,unknown>(),storageAvailable:true}));
vi.mock("../../infrastructure/storage/repository-runtime.js",()=>({
  getRepositoryRuntime:()=>fake.storageAvailable?{driver:"postgres",postgres:{pool:{
    query:async(_sql:string,values:[string])=>({rows:fake.records.has(values[0])?[fake.records.get(values[0])]:[]}),
  }}}:{driver:"memory"},
}));
vi.mock("../../infrastructure/storage/postgres-repository-fence.js",()=>({
  withPostgresRepositoryFence:async(_input:unknown,operation:(fence:unknown)=>Promise<unknown>)=>operation({aggregateType:"qa_public_one_shot",aggregateId:"synthetic",ownerId:"tester",fencingToken:1}),
}));
vi.mock("../../infrastructure/storage/postgres-primary-store.js",()=>({
  PostgresPrimaryStore:class{
    withAggregateTransaction(_fence:unknown,operation:(transaction:unknown)=>Promise<unknown>){
      return operation({
        readCommandResult:async(input:{commandId:string})=>(fake.records.get(input.commandId) as any)?.result_payload??null,
        recordCommandResult:async(input:{commandId:string;aggregateType:string;aggregateId:string;commandType:string;requestHash:string;result:unknown;retainUntil:string})=>{
          if(fake.records.has(input.commandId))throw Error("synthetic_conflict");
          fake.records.set(input.commandId,{aggregate_type:input.aggregateType,aggregate_id:input.aggregateId,
            command_type:input.commandType,request_hash:input.requestHash,result_payload:input.result,retain_until:input.retainUntil});
          return {inserted:true,result:input.result};
        },
      });
    }
  },
}));

const now=Date.parse("2026-09-24T10:00:00.000Z");
const env=()=>({PUBLIC_QA_ONE_SHOT_ENABLED:"true",PUBLIC_QA_ONE_SHOT_AUTHORIZATION_ID:"qa-authorization-1",
  PUBLIC_QA_ONE_SHOT_OWNER_ID:"qa-owner",PUBLIC_QA_ONE_SHOT_DEPLOYMENT_ID:"qa-candidate",
  PUBLIC_QA_ONE_SHOT_EXPIRES_AT:new Date(now+3_600_000).toISOString(),PUBLIC_QA_ONE_SHOT_MAX_WALL_SECONDS:"40",
  API_RESULT_SYNC_DEPLOYMENT_ID:"qa-candidate"});
const first=`public-${"a".repeat(64)}`,second=`public-${"b".repeat(64)}`;

describe("dedicated public QA one-shot reservation",()=>{
  beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);fake.records.clear();fake.storageAvailable=true;});
  afterEach(()=>{vi.useRealTimers();});
  it("is absent by default and rejects partial or unsafe opt-in at boot",()=>{
    expect(publicQaOneShotGuardFromEnvironment({})).toBeUndefined();
    for(const change of [{PUBLIC_QA_ONE_SHOT_ENABLED:"false"},{PUBLIC_QA_ONE_SHOT_DEPLOYMENT_ID:"other"},
      {PUBLIC_QA_ONE_SHOT_MAX_WALL_SECONDS:"60"},{PUBLIC_QA_ONE_SHOT_EXPIRES_AT:new Date(now-1).toISOString()},
      {PUBLIC_QA_ONE_SHOT_EXPIRES_AT:"tomorrow"},{PUBLIC_QA_ONE_SHOT_AUTHORIZATION_ID:"short"}]){
      expect(()=>publicQaOneShotGuardFromEnvironment({...env(),...change})).toThrow("public_qa_one_shot_not_configured");
    }
    fake.storageAvailable=false;
    expect(()=>publicQaOneShotGuardFromEnvironment(env())).toThrow("public_qa_one_shot_not_configured");
  });
  it("persists one session across guard recreation; retries reuse only that identity",async()=>{
    const guard=publicQaOneShotGuardFromEnvironment(env())!;
    await guard.reserve(first,"qa-owner","qa-candidate");
    await guard.reserve(first,"qa-owner","qa-candidate");
    await publicQaOneShotGuardFromEnvironment(env())!.assertReserved(first,"qa-owner","qa-candidate");
    await expect(guard.reserve(second,"qa-owner","qa-candidate")).rejects.toMatchObject({code:"public_qa_one_shot_consumed",status:409});
    expect(fake.records.size).toBe(1);
    const stored=[...fake.records.values()][0] as {retain_until:string};
    expect(Date.parse(stored.retain_until)).toBe(Date.parse(env().PUBLIC_QA_ONE_SHOT_EXPIRES_AT)+90*24*60*60*1000);
  });
  it("rejects a different account, missing record, expired window and unavailable store",async()=>{
    const guard=publicQaOneShotGuardFromEnvironment(env())!;
    await expect(guard.reserve(first,"ordinary-owner","qa-candidate")).rejects.toMatchObject({status:403});
    await expect(guard.assertReserved(first,"qa-owner","qa-candidate")).rejects.toMatchObject({code:"public_qa_one_shot_unreserved"});
    fake.storageAvailable=false;
    await expect(guard.reserve(first,"qa-owner","qa-candidate")).rejects.toMatchObject({status:503});
    fake.storageAvailable=true;
    vi.setSystemTime(now+3_600_001);
    await expect(guard.reserve(first,"qa-owner","qa-candidate")).rejects.toMatchObject({status:403});
  });
  it("rejects a tampered durable command binding",async()=>{
    const guard=publicQaOneShotGuardFromEnvironment(env())!;
    await guard.reserve(first,"qa-owner","qa-candidate");
    const [key,record]=[...fake.records.entries()][0] as [string,{request_hash:string}];
    fake.records.set(key,{...record,request_hash:"f".repeat(64)});
    await expect(guard.assertReserved(first,"qa-owner","qa-candidate")).rejects.toMatchObject({code:"public_qa_one_shot_unreserved"});
  });
});
