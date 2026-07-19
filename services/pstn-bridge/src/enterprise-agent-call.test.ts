import { describe, expect, it } from "vitest";
import { parseAgentCallRequest } from "./server.js";

describe("enterprise PSTN agent call parsing", () => {
  it("requires a complete enterprise routing context", () => {
    expect(parseAgentCallRequest({ ...call(), enterpriseContext: {
      tenantId: "00000000-0000-4000-8000-000000000001",
    } })).toBeNull();
    expect(parseAgentCallRequest({ ...call(), enterpriseContext: {
      tenantId: "00000000-0000-4000-8000-000000000001",
      homeRegion: "cn-north", cellId: "cell-a", routeEpoch: 3,
      taskId: "00000000-0000-4000-8000-000000000002",
      dispatchGeneration: 4,
    } })).toMatchObject({ enterpriseContext: { routeEpoch: 3,
      dispatchGeneration: 4 } });
  });
});

function call() { return { idempotencyKey: "marketing:pstn:tenant:task:g1",
  draftId: "00000000-0000-4000-8000-000000000002", callId: "session-1",
  targetPhone: "+14155552671", objective: "预约演示", suggestedScript: "预约演示",
  language: "zh-CN", consentPromptVersion: "policy-1" }; }
