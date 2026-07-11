import { describe, expect, test } from "vitest";
import { appendAgentCallWorkerReadiness } from "./domestic_release_agent_call_checks.mjs";

describe("appendAgentCallWorkerReadiness", () => {
  test("records ready agent call worker smoke", async () => {
    const context = baseContext({ checkFn: async () => readyResult() });

    await appendAgentCallWorkerReadiness(context);

    expect(context.checks).toEqual([{
      name: "agent_call_worker_readiness",
      status: "pass",
      details: {
        status: "ready",
        draftId: "draft-1",
        callId: "call-1",
        providerCallId: "provider-call-1",
        checks: [{ name: "agent_call_insufficient_balance_blocks_queue", status: "pass" }],
      },
    }]);
    expect(context.issues).toEqual([]);
  });

  test("aggregates failed agent call worker blockers", async () => {
    const context = baseContext({
      checkFn: async () => ({
        ...readyResult(),
        status: "not_ready",
        issues: ["Worker did not dispatch queued draft."],
        actions: ["Inspect worker log."],
      }),
    });

    await appendAgentCallWorkerReadiness(context);

    expect(context.checks[0]).toMatchObject({
      name: "agent_call_worker_readiness",
      status: "fail",
      details: { status: "not_ready" },
    });
    expect(context.issues).toContain("agent_call_worker_readiness is not ready.");
    expect(context.issues).toContain("Worker did not dispatch queued draft.");
    expect(context.actions).toContain("Inspect worker log.");
  });

  test("records an explicit skipped check", async () => {
    const context = baseContext({ enabled: false });

    await appendAgentCallWorkerReadiness(context);

    expect(context.checks).toEqual([{
      name: "agent_call_worker_readiness",
      status: "pass",
      details: { skipped: true },
    }]);
  });
});

function readyResult() {
  return {
    status: "ready",
    draftId: "draft-1",
    callId: "call-1",
    providerCallId: "provider-call-1",
    checks: [{ name: "agent_call_insufficient_balance_blocks_queue", status: "pass" }],
    issues: [],
    actions: [],
  };
}

function baseContext(overrides = {}) {
  return {
    enabled: true,
    root: "/repo",
    timeoutMs: 1000,
    checks: [],
    issues: [],
    actions: [],
    record: (checks, name, ok, details = {}) => {
      checks.push({ name, status: ok ? "pass" : "fail", details });
    },
    normalizeIssues: (issues) => issues ?? [],
    ...overrides,
  };
}
