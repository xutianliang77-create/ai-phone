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
    } })).toBeNull();
    expect(parseAgentCallRequest({ ...call(), enterpriseContext: context(),
      enterpriseAgent: agent() })).toMatchObject({
        enterpriseContext: { routeEpoch: 3, dispatchGeneration: 4 },
        enterpriseAgent: { runId: "00000000-0000-4000-8000-000000000003",
          disclosureRequired: true } });
  });

  it("rejects an incomplete or insecure Marketing Agent runtime binding", () => {
    expect(parseAgentCallRequest({ ...call(), enterpriseContext: context(),
      enterpriseAgent: { ...agent(), runtimeUrl: "http://agent.internal" } })).toBeNull();
    expect(parseAgentCallRequest({ ...call(), enterpriseContext: context(),
      enterpriseAgent: { ...agent(), disclosureRequired: false } })).toBeNull();
    expect(parseAgentCallRequest({ ...call(), enterpriseContext: {
      ...context(), routeEpoch: 4 }, enterpriseAgent: agent() })).toBeNull();
  });
});

function context() { return {
  tenantId: "00000000-0000-4000-8000-000000000001",
  homeRegion: "cn-north", cellId: "cell-a", routeEpoch: 3,
  taskId: "00000000-0000-4000-8000-000000000002", dispatchGeneration: 4,
}; }
function agent() { return { runtimeUrl: "https://agent.internal/enterprise",
  ticket: `${Buffer.from(JSON.stringify({
    ticketId: "00000000-0000-4000-8000-000000000005",
    tenantId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000003",
    dispatchId: "00000000-0000-4000-8000-000000000006",
    taskId: "00000000-0000-4000-8000-000000000002",
    communicationSessionId: "00000000-0000-4000-8000-000000000007",
    dispatchGeneration: 4, routeEpoch: 3,
    expiresAt: "2099-01-01T00:00:00.000Z",
  })).toString("base64url")}.signature`,
  runId: "00000000-0000-4000-8000-000000000003", disclosureRequired: true,
}; }

function call() { return { idempotencyKey: "marketing:pstn:tenant:task:g1",
  draftId: "00000000-0000-4000-8000-000000000002",
  callId: "00000000-0000-4000-8000-000000000007",
  targetPhone: "+14155552671", objective: "预约演示", suggestedScript: "预约演示",
  language: "zh-CN", consentPromptVersion: "policy-1" }; }
