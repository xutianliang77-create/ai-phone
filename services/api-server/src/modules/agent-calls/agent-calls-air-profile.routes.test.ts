import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  captureAgentCallEnv,
  clearAgentCallEnv,
  configureAirAgentExecutionEnv,
  createAuthorizedDraft,
  restoreAgentCallEnv,
} from "./agent-calls.test-support.js";

describe("Air780 agent call profile", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureAgentCallEnv();
    clearAgentCallEnv();
    resetStore();
  });

  afterEach(() => restoreAgentCallEnv(previousEnv));

  it("queues without creating a SIP operation", async () => {
    configureAirAgentExecutionEnv();
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app);
    const queued = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/start`,
      payload: { consentPromptVersion: "cn-agent-v1" },
    });
    const claimed = await app.inject({
      method: "POST",
      url: "/internal/ai-calling-agent/drafts/claims",
      headers: { authorization: "Bearer internal-secret-for-agent" },
      payload: { workerId: "air-route-test-worker", limit: 1 },
    });
    await app.close();

    expect(queued.statusCode).toBe(200);
    expect(queued.json().draft).toMatchObject({
      status: "queued",
      executionProvider: "air780_volte",
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().claims).toHaveLength(1);
    expect(getStoreSnapshot().agentToolExecutions).toContainEqual(
      expect.objectContaining({ toolName: "place_phone_call" }),
    );
    expect(getStoreSnapshot().providerOperations).toContainEqual(
      expect.objectContaining({
        provider: "air780_volte",
        operationType: "phone_outbound",
      }),
    );
    expect(getStoreSnapshot().providerOperations).not.toContainEqual(
      expect.objectContaining({ operationType: "sip_outbound" }),
    );
  });

  it("fails closed before queueing when the Gateway is not configured", async () => {
    configureAirAgentExecutionEnv();
    delete process.env.AIR_DEVICE_GATEWAY_BASE_URL;
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app);

    const response = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/start`,
      payload: { consentPromptVersion: "cn-agent-v1" },
    });
    await app.close();

    expect(response.statusCode).toBe(503);
    expect(response.json().readiness.issues).toContain(
      "AIR_DEVICE_GATEWAY_BASE_URL is invalid",
    );
    expect(getStoreSnapshot().providerOperations).toHaveLength(0);
  });
});

function resetStore() {
  const store = getStoreSnapshot();
  store.agentCallDrafts = [];
  store.usageBalances = {};
  store.usagePlanCodes = {};
  store.usageHolds = [];
  store.billingLedger = [];
  store.sessions = [];
  store.providerOperations = [];
  store.agentRuns = [];
  store.agentSteps = [];
  store.agentToolExecutions = [];
}
