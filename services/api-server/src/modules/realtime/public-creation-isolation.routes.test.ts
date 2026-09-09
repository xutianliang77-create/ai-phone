import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createRealtimeSession } from "./realtime.service.js";
const request={mode:"conversation" as const,sourceLanguage:"zh" as const,targetLanguage:"en" as const,voiceOutput:false};
const effects=()=>{const s=getStoreSnapshot();return structuredClone({sessions:s.sessions,holds:s.usageHolds,ledger:s.billingLedger});};
afterEach(()=>vi.unstubAllEnvs());
describe("public creation cannot downgrade to private admission",()=>{
  it.each(["public-test","   "])("refuses legacy creation before hold/session writes for configured identity %j",async id=>{
    vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID",id);const app=await buildApp();
    try {const before=effects();const r=await app.inject({method:"POST",url:"/realtime/sessions",payload:request});
      expect(r.statusCode).toBe(503);expect(r.json().error.code).toBe("processing_contract_required");expect(effects()).toEqual(before);
    }finally{await app.close();}
  });
  it("also protects the original service entry, not only the HTTP route",async()=>{
    vi.stubEnv("API_RESULT_SYNC_DEPLOYMENT_ID","public-test");const before=effects();
    await expect(createRealtimeSession("guest-user",request)).rejects.toThrow("processing_contract_required");
    expect(effects()).toEqual(before);
  });
});
