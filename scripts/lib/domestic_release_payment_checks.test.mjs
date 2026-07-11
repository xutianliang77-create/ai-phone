import { describe, expect, test } from "vitest";
import { appendDomesticPaymentCallbacksLocalSmoke } from "./domestic_release_payment_checks.mjs";

describe("appendDomesticPaymentCallbacksLocalSmoke", () => {
  test("records a ready domestic payment callback smoke", async () => {
    const context = baseContext({
      checkFn: async () => ({
        status: "ready",
        checks: [{ name: "wechat_signed_callback_paid", status: "pass" }],
        issues: [],
        actions: [],
      }),
    });

    await appendDomesticPaymentCallbacksLocalSmoke(context);

    expect(context.checks).toEqual([
      {
        name: "domestic_payment_callbacks_local_smoke",
        status: "pass",
        details: {
          status: "ready",
          checks: [{ name: "wechat_signed_callback_paid", status: "pass" }],
        },
      },
    ]);
    expect(context.issues).toEqual([]);
    expect(context.actions).toEqual([]);
  });

  test("aggregates failed payment callback smoke blockers", async () => {
    const context = baseContext({
      checkFn: async () => ({
        status: "not_ready",
        checks: [{ name: "wechat_invalid_signature_rejected", status: "fail" }],
        issues: ["bad signature was accepted"],
        actions: ["Fix billing callback verification."],
      }),
    });

    await appendDomesticPaymentCallbacksLocalSmoke(context);

    expect(context.checks[0]).toMatchObject({
      name: "domestic_payment_callbacks_local_smoke",
      status: "fail",
      details: { status: "not_ready" },
    });
    expect(context.issues).toContain("domestic_payment_callbacks_local_smoke is not ready.");
    expect(context.issues).toContain("bad signature was accepted");
    expect(context.actions).toContain("Fix billing callback verification.");
  });

  test("records an explicit skipped check", async () => {
    const context = baseContext({ enabled: false });

    await appendDomesticPaymentCallbacksLocalSmoke(context);

    expect(context.checks).toEqual([
      {
        name: "domestic_payment_callbacks_local_smoke",
        status: "pass",
        details: { skipped: true },
      },
    ]);
  });
});

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
