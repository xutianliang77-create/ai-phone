import { describe, expect, test } from "vitest";
import {
  buildAgentCallWorkerReadinessConfig,
  probeAgentCallWorkerFlow,
} from "./agent_call_worker_readiness.mjs";

describe("buildAgentCallWorkerReadinessConfig", () => {
  test("builds isolated domestic Agent Worker settings", async () => {
    const config = await buildAgentCallWorkerReadinessConfig({
      root: "/repo",
      apiPort: 3420,
      bridgePort: 3422,
      timeoutMs: 1234,
    });

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:3420");
    expect(config.bridgeBaseUrl).toBe("http://127.0.0.1:3422");
    expect(config.timeoutMs).toBe(1234);
    expect(config.apiEnv.CALL_PROVIDER_POLICY).toBe("domestic_pstn_bridge");
    expect(config.apiEnv.PSTN_WEBHOOK_BASE_URL).toBe("https://calls.qkxy.cn");
    expect(config.workerEnv.PSTN_BRIDGE_BASE_URL).toBe("http://127.0.0.1:3422");
  });
});

describe("probeAgentCallWorkerFlow", () => {
  test("passes when the queued draft is dispatched and marked in progress", async () => {
    const config = await buildAgentCallWorkerReadinessConfig({
      root: "/repo",
      apiPort: 3420,
      bridgePort: 3422,
      timeoutMs: 1000,
    });
    const checks = [];
    const issues = [];
    const requests = [];
    const bridge = { calls: [] };
    const state = { status: "draft", providerCallId: null };
    const result = await probeAgentCallWorkerFlow({
      config,
      checks,
      issues,
      actions: [],
      bridge,
      fetchFn: fakeFetch(requests, state),
      waitForWorkerDispatch: async ({ draft }) => {
        state.status = "in_progress";
        state.providerCallId = "mock-pstn-call-1";
        bridge.calls.push({
          headers: { authorization: "Bearer local-pstn-bridge-secret" },
          body: { draftId: draft.id, callId: draft.callId },
        });
        return { bridgeCall: bridge.calls[0] };
      },
    });

    expect(result).toEqual({
      draftId: "draft-1",
      callId: "call-1",
      providerCallId: "mock-pstn-call-1",
    });
    expect(issues).toEqual([]);
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["api_service_identity", "pass"],
      ["internal_queue_requires_secret", "pass"],
      ["agent_draft_created", "pass"],
      ["agent_draft_authorized", "pass"],
      ["agent_draft_queued", "pass"],
      ["pstn_bridge_received_call", "pass"],
      ["pstn_bridge_authorized", "pass"],
      ["worker_status_updated", "pass"],
      ["pstn_webhook_completed", "pass"],
      ["agent_call_insufficient_balance_blocks_queue", "pass"],
    ]);
    expect(requests.find((request) => request.path.endsWith("/start"))?.body)
      .toEqual({ consentPromptVersion: "cn-agent-v1" });
    expect(requests.find((request) => request.path === "/webhooks/pstn/agent-calls")?.body)
      .toMatchObject({ consumedSeconds: 300 });
  });

  test("fails when the internal queue is public", async () => {
    const config = await buildAgentCallWorkerReadinessConfig({
      root: "/repo",
      apiPort: 3420,
      bridgePort: 3422,
    });
    const checks = [];
    const issues = [];
    const state = { status: "draft", providerCallId: null };

    await probeAgentCallWorkerFlow({
      config,
      checks,
      issues,
      actions: [],
      bridge: { calls: [] },
      fetchFn: fakeFetch([], state, { publicQueue: true }),
      waitForWorkerDispatch: async ({ draft }) => {
        state.status = "in_progress";
        state.providerCallId = "mock-pstn-call-1";
        return { bridgeCall: {
          headers: { authorization: "Bearer local-pstn-bridge-secret" },
          body: { draftId: draft.id, callId: draft.callId },
        } };
      },
    });

    expect(issues).toContain("Internal agent call queue did not reject unauthenticated requests.");
    expect(checks.find((check) => check.name === "internal_queue_requires_secret")?.status)
      .toBe("fail");
  });
});

function fakeFetch(requests, state, options = {}) {
  return async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const path = new URL(url).pathname;
    requests.push({ path, body, headers: init.headers ?? {} });
    if (path === "/health") {
      return jsonResponse(200, { service: "api-server", version: "0.1.0" });
    }
    if (path === "/internal/ai-calling-agent/drafts/queued") {
      return options.publicQueue
        ? jsonResponse(200, { drafts: [] })
        : jsonResponse(401, { error: { code: "internal_error" } });
    }
    if (path === "/ai-calling-agent/drafts" && init.method === "POST") {
      state.status = "draft";
      state.providerCallId = null;
      return jsonResponse(201, draftBody(state));
    }
    if (path.endsWith("/authorize")) {
      state.status = "authorized";
      return jsonResponse(200, draftBody(state));
    }
    if (path.endsWith("/start")) {
      if (state.balanceExhausted) {
        state.status = "authorized";
        return jsonResponse(402, {
          error: { code: "agent_call_insufficient_balance" },
          usage: { remainingSeconds: 0, minimumStartSeconds: 60 },
          ...draftBody(state),
        });
      }
      state.status = "queued";
      return jsonResponse(200, draftBody(state));
    }
    if (path === "/webhooks/pstn/agent-calls") {
      state.status = "completed";
      state.providerCallId = body.providerCallId;
      state.balanceExhausted = body.consumedSeconds >= 300;
      return jsonResponse(200, { status: "updated", ...draftBody(state) });
    }
    if (path === "/ai-calling-agent/drafts/draft-1") {
      return jsonResponse(200, draftBody(state));
    }
    return jsonResponse(404, { error: { message: `unexpected ${path}` } });
  };
}

function draftBody(state) {
  return {
    draft: {
      id: "draft-1",
      scenario: "booking",
      status: state.status,
      targetPhone: "+8613800138000",
      objective: "预约明天下午三点的英语口语体验课",
      suggestedScript: "您好，我想预约明天下午三点的英语口语体验课。",
      language: "zh",
      riskLevel: "low",
      riskReasons: [],
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
      callId: state.status === "queued" || state.status === "in_progress" ? "call-1" : undefined,
      providerCallId: state.providerCallId,
    },
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
