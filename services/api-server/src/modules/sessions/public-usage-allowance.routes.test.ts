import {afterEach,describe,expect,it,vi} from "vitest";
import {buildApp} from "../../app.js";
import {getStoreSnapshot} from "../../infrastructure/storage/json-store.js";
import {createUsageHold} from "../usage/usage.service.js";

afterEach(()=>vi.unstubAllEnvs());
describe("public account allowance route",()=>{
  it("renews an active session under the original account balance and keeps competitors reserved",async()=>{
    vi.stubEnv("INTERNAL_API_SECRET","synthetic-allowance-admin");
    const store=getStoreSnapshot();
    store.sessions=["first","second"].map(id=>({
      id,userId:"owner",mode:"conversation",status:"active",createdAt:new Date().toISOString(),
      consumedSeconds:0,segments:[],processingAuthorization:{processingMode:"online"},
      publicRealtimeIssuance:{},publicRuntime:{phase:"active"},
    })) as typeof store.sessions;
    store.usageBalances={owner:90};store.usagePlanCodes={owner:"free"};
    store.usageHolds=[];store.billingLedger=[];
    for(const sessionId of ["first","second"]){
      expect(createUsageHold("owner",30,undefined,{sessionId,idempotencyKey:`hold:${sessionId}`}).status).toBe("held");
    }
    const app=await buildApp(),headers={authorization:"Bearer synthetic-allowance-admin"};
    try{
      expect((await app.inject({method:"POST",url:"/internal/usage/allowance/first",payload:{targetSeconds:60}})).statusCode).toBe(401);
      const first=await app.inject({method:"POST",url:"/internal/usage/allowance/first",headers,payload:{targetSeconds:60}});
      const replay=await app.inject({method:"POST",url:"/internal/usage/allowance/first",headers,payload:{targetSeconds:60}});
      const second=await app.inject({method:"POST",url:"/internal/usage/allowance/second",headers,payload:{targetSeconds:60}});
      expect(first.json()).toMatchObject({status:"held",authorizedSeconds:60,remainingSeconds:90,availableSeconds:0});
      expect(replay.json()).toMatchObject({status:"held",authorizedSeconds:60});
      expect(second.json()).toMatchObject({status:"insufficient",authorizedSeconds:30,availableSeconds:0});
      expect(store.usageHolds.map(hold=>hold.seconds)).toEqual([60,30]);
      expect(store.billingLedger).toHaveLength(0);
      expect((await app.inject({method:"POST",url:"/internal/usage/allowance/first",headers,payload:{targetSeconds:2_147_483_648}})).statusCode).toBe(400);
    }finally{await app.close();}
  });
});
