import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {buildApp} from "../../app.js";
import {getStoreSnapshot} from "../../infrastructure/storage/json-store.js";
beforeEach(()=>{
  vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");
  vi.stubEnv("AUTH_TEST_PHONE","13900139002");vi.stubEnv("AUTH_TEST_CODE","123456");
  const s=getStoreSnapshot();s.accounts=[];s.authSessions=[];s.smsOtpChallenges=[];
});
afterEach(()=>vi.unstubAllEnvs());
it("rejects absent/wrong deployment before issuing credentials or sending a code",async()=>{
  const app=await buildApp();try{
    for(const deploymentId of [undefined,"private-old"]){
      for(const path of ["/auth/phone/request-code","/auth/phone/login"]){
        const response=await app.inject({method:"POST",url:path,payload:{phone:"13900139002",code:"123456",deploymentId}});
        expect(response.statusCode).toBe(503);
      }
    }
    expect(getStoreSnapshot().smsOtpChallenges).toEqual([]);expect(getStoreSnapshot().authSessions).toEqual([]);
  }finally{await app.close();}
});
it("returns the configured deployment with the authenticated login result",async()=>{
  const app=await buildApp();try{
    const identity=await app.inject({method:"GET",url:"/auth/deployment"});
    expect(identity.statusCode).toBe(200);expect(identity.json()).toEqual({deploymentId:"public-test"});
    const response=await app.inject({method:"POST",url:"/auth/phone/login",
      payload:{phone:"13900139002",code:"123456",deploymentId:"public-test"}});
    expect(response.statusCode).toBe(200);expect(response.json().deploymentId).toBe("public-test");
    const me=await app.inject({method:"GET",url:"/account/me",headers:{authorization:`Bearer ${response.json().token}`}});
    expect(me.json().account.id).toBe(response.json().account.id);
    expect(getStoreSnapshot().smsOtpChallenges).toEqual([]);
  }finally{await app.close();}
});
