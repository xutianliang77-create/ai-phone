import { describe, expect, test } from "vitest";
import {
  buildPstnProviderStatusEventConfig,
  probePstnProviderStatusEvent,
} from "./pstn_provider_status_event_readiness.mjs";

describe("buildPstnProviderStatusEventConfig", () => {
  test("builds isolated PSTN provider status event settings", async () => {
    const config = await buildPstnProviderStatusEventConfig({
      root: "/repo",
      apiPort: 3426,
      bridgePort: 3427,
      timeoutMs: 1234,
    });

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:3426");
    expect(config.bridgeBaseUrl).toBe("http://127.0.0.1:3427");
    expect(config.timeoutMs).toBe(1234);
    expect(config.apiEnv.AUTH_TEST_PHONE).toBe("13800138000");
    expect(config.apiEnv.AUTH_TEST_CODE).toBe("246810");
    expect(config.apiEnv.AGENT_CALL_PROVIDER_ADAPTER).toBe("pstn_http");
    expect(config.apiEnv.PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED).toBe("true");
    expect(config.bridgeEnv.PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT)
      .toBe("http://127.0.0.1:3426/webhooks/pstn/agent-calls");
  });
});

describe("probePstnProviderStatusEvent", () => {
  test("passes when signed provider status events update the API draft", async () => {
    const checks = [];
    const issues = [];
    const actions = [];

    await probePstnProviderStatusEvent({
      config: await buildPstnProviderStatusEventConfig({ apiPort: 3426, bridgePort: 3427 }),
      checks,
      issues,
      actions,
      fetchFn: fakeStatusFetch({ updateDraft: true }),
    });

    expect(issues).toEqual([]);
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["api_service_identity", "pass"],
      ["pstn_bridge_service_identity", "pass"],
      ["account_login", "pass"],
      ["agent_draft_queued", "pass"],
      ["provider_status_event_requires_signature", "pass"],
      ["provider_status_event_rejects_invalid_payload", "pass"],
      ["provider_status_event_updates_in_progress", "pass"],
      ["provider_status_event_deduplicates_event_id", "pass"],
      ["provider_status_event_updates_completed", "pass"],
    ]);
  });

  test("fails when accepted provider status events do not update the API draft", async () => {
    const checks = [];
    const issues = [];

    await probePstnProviderStatusEvent({
      config: await buildPstnProviderStatusEventConfig({ apiPort: 3426, bridgePort: 3427 }),
      checks,
      issues,
      actions: [],
      fetchFn: fakeStatusFetch({ updateDraft: false }),
    });

    expect(issues).toContain("PSTN provider status event smoke failed.");
    expect(checks.find((check) => check.name === "provider_status_event_updates_in_progress")?.status)
      .toBe("fail");
  });
});

function fakeStatusFetch(options) {
  const draft = { id: "draft-1", status: "draft", callId: null };
  const seenEventIds = new Set();
  return async (url, init = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    const signature = init.headers?.["x-pstn-provider-signature"];
    if (path === "/health" && parsed.port === "3426") {
      return jsonResponse(200, { service: "api-server" });
    }
    if (path === "/health" && parsed.port === "3427") {
      return jsonResponse(200, { service: "pstn-bridge" });
    }
    if (path === "/auth/phone/login") {
      return body?.phone === "13800138000" && body?.code === "246810"
        ? jsonResponse(200, {
          token: "local-status-account-token",
          account: { id: "account-1" },
        })
        : jsonResponse(401, { error: { message: "Phone login failed" } });
    }
    if (path.startsWith("/ai-calling-agent/") &&
      init.headers?.authorization !== "Bearer local-status-account-token") {
      return jsonResponse(401, { error: { message: "Account login required" } });
    }
    if (path === "/ai-calling-agent/drafts" && init.method === "POST") {
      return jsonResponse(200, { draft });
    }
    if (path === "/ai-calling-agent/drafts/draft-1/authorize") {
      draft.status = "authorized";
      return jsonResponse(200, { draft });
    }
    if (path === "/ai-calling-agent/drafts/draft-1/start") {
      Object.assign(draft, { status: "queued", callId: "call-status-smoke" });
      return jsonResponse(200, { draft });
    }
    if (path === "/ai-calling-agent/drafts/draft-1") {
      return jsonResponse(200, { draft });
    }
    if (path === "/provider/status-events" && !signature) {
      return jsonResponse(401, { error: { code: "invalid_provider_signature" } });
    }
    if (path === "/provider/status-events" && body.eventType !== "call.status") {
      return jsonResponse(400, { error: { code: "invalid_provider_status_event" } });
    }
    if (path === "/provider/status-events") {
      if (seenEventIds.has(body.eventId)) {
        return jsonResponse(200, { status: "duplicate", eventId: body.eventId });
      }
      seenEventIds.add(body.eventId);
      if (options.updateDraft) applyStatusEvent(draft, body);
      return jsonResponse(200, { status: "accepted", eventId: body.eventId });
    }
    return jsonResponse(404, { error: { message: `unexpected ${path}` } });
  };
}

function applyStatusEvent(draft, body) {
  if (body.status === "completed") {
    Object.assign(draft, {
      status: "completed",
      consumedSeconds: body.consumedSeconds,
      usageSettledAt: "2026-07-03T00:00:00.000Z",
      resultSummary: body.resultSummary,
    });
    return;
  }
  Object.assign(draft, { status: "in_progress", providerCallId: body.providerCallId });
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
