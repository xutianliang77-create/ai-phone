import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  captureAgentCallEnv,
  clearAgentCallEnv,
  configureAgentExecutionEnv,
  createAuthorizedDraft,
  restoreAgentCallEnv,
} from "./agent-calls.test-support.js";
import {
  cancelAgentCallDraft,
  createAgentCallDraft,
} from "./agent-calls.repository.js";

describe("agent call cancellation", () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = captureAgentCallEnv();
    clearAgentCallEnv();
    const store = getStoreSnapshot();
    store.agentCallDrafts = [];
    store.usageBalances = {};
    store.usagePlanCodes = {};
    store.usageHolds = [];
    store.billingLedger = [];
  });

  afterEach(() => restoreAgentCallEnv(previousEnv));

  it("cancels drafts before authorization and blocks later authorization", async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/ai-calling-agent/drafts",
      payload: { scenario: "booking", objective: "预约牙医复诊" },
    });
    const draftId = created.json().draft.id as string;
    const cancelled = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/cancel`,
      payload: { reason: "用户确认前取消" },
    });
    const authorized = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/authorize`,
      payload: { userConfirmed: true, consentPromptVersion: "cn-agent-v1" },
    });
    await app.close();

    expect(cancelled.json().draft).toMatchObject({
      status: "cancelled",
      cancellationReason: "用户确认前取消",
    });
    expect(cancelled.json().draft.cancelledAt).toEqual(expect.any(String));
    expect(authorized.statusCode).toBe(409);
    expect(authorized.json().error.code).toBe("agent_call_cancelled");
  });

  it("cancels authorized drafts that have not entered the execution queue", async () => {
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app);
    const cancelled = await app.inject({
      method: "POST",
      url: `/ai-calling-agent/drafts/${draftId}/cancel`,
      payload: { reason: "user_cancelled" },
    });
    await app.close();

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().draft.status).toBe("cancelled");
    expect(getStoreSnapshot().usageHolds).toHaveLength(0);
  });

  it("does not cancel a draft owned by another user", () => {
    const draft = createAgentCallDraft("owner-user", {
      scenario: "booking",
      objective: "预约牙医复诊",
    });

    const result = cancelAgentCallDraft("other-user", draft!.id, {
      reason: "user_cancelled",
    });

    expect(result.status).toBe("not_found");
    expect(getStoreSnapshot().agentCallDrafts[0]?.status).toBe("draft");
  });

  it("serializes concurrent start and cancel for the same authorized draft", async () => {
    configureAgentExecutionEnv();
    const app = await buildApp();
    const draftId = await createAuthorizedDraft(app, true);

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/ai-calling-agent/drafts/${draftId}/start`,
        payload: { consentPromptVersion: "cn-agent-v1" },
      }),
      app.inject({
        method: "POST",
        url: `/ai-calling-agent/drafts/${draftId}/cancel`,
        payload: { reason: "user_cancelled" },
      }),
    ]);
    await app.close();

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const draft = getStoreSnapshot().agentCallDrafts.find(
      (item) => item.id === draftId,
    );
    expect(["queued", "cancelled"]).toContain(draft?.status);
    expect(getStoreSnapshot().usageHolds).toHaveLength(
      draft?.status === "queued" ? 1 : 0,
    );
  });
});
