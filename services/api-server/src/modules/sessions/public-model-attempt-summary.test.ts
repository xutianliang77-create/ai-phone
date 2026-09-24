import {describe,expect,it} from "vitest";
import type {PublicModelAttemptEvent} from "@translation/contracts";
import {updatedPublicAttemptSummary} from "./public-model-attempt-summary.js";
import {publicProcessingDiagnostics} from "./public-processing-diagnostics.js";
import type {SessionRecord} from "./session-record.js";

describe("bounded public attempt summary",()=>{
  it("retains 10000 distinct completed attempts without growing the session aggregate",()=>{
    let summary:SessionRecord["publicAttemptSummary"];
    for(let index=0;index<10_000;index++){
      const intent:PublicModelAttemptEvent={sessionId:"long-session",leaseId:"lease",attemptId:`attempt-${index}`,
        segmentId:`segment-${index}`,revision:1,component:"translation",providerId:"tencent",
        modelId:"service:tencent_tmt",state:"dispatching"};
      summary=updatedPublicAttemptSummary(summary,undefined,{event:intent});
      summary=updatedPublicAttemptSummary(summary,{event:intent},
        {event:{...intent,state:"confirmed",metadata:{usage:{promptTokens:1}}}});
    }
    expect(summary).toMatchObject({total:10_000,states:{dispatching:0,confirmed:10_000},
      components:{translation:{total:10_000,confirmed:10_000,providerIds:["tencent"],
        modelIds:["service:tencent_tmt"]}},reportedUsage:{promptTokens:10_000}});
    expect(JSON.stringify(summary).length).toBeLessThan(1400);
    const session={id:"long-session",status:"active",consumedSeconds:0,publicAttemptStorageVersion:2,
      publicAttemptSummary:summary,publicModelAttempts:[],processingAuthorization:{executionPlan:{
        asr:{execution:"public"},translation:{execution:"public"},tts:{execution:"disabled"}}}} as SessionRecord;
    const diagnostics=publicProcessingDiagnostics(session);
    expect(diagnostics.totals).toMatchObject({publicAttemptCount:10_000,confirmedPublicAttemptCount:10_000});
    expect(diagnostics.providerUsage).toMatchObject({reported:{promptTokens:10_000},moneyCostStatus:"unknown"});
  });
});
