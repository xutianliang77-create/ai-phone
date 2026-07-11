import { describe, expect, test } from "vitest";
import { appendDiagnosticsAlertingLocalSmoke } from "./domestic_release_diagnostics_checks.mjs";

describe("appendDiagnosticsAlertingLocalSmoke", () => {
  test("records ready local diagnostics alerting smoke evidence", async () => {
    const context = contextWith({
      checkFn: async () => ({
        status: "ready",
        webhookCallCount: 1,
        checks: [{ name: "diagnostics_alert_webhook_received_signed_test", status: "pass" }],
        issues: [],
        actions: [],
      }),
    });

    await appendDiagnosticsAlertingLocalSmoke(context);

    expect(context.issues).toEqual([]);
    expect(context.checks).toEqual([{
      name: "diagnostics_alerting_local_smoke",
      status: "pass",
      details: {
        status: "ready",
        webhookCallCount: 1,
        checks: [{ name: "diagnostics_alert_webhook_received_signed_test", status: "pass" }],
      },
    }]);
  });

  test("adds issues and actions when local smoke fails", async () => {
    const context = contextWith({
      checkFn: async () => ({
        status: "not_ready",
        webhookCallCount: 0,
        checks: [{ name: "diagnostics_alert_webhook_received_signed_test", status: "fail" }],
        issues: ["Diagnostics alert webhook did not receive a signed test alert."],
        actions: ["Inspect diagnostics alerting local stack logs."],
      }),
    });

    await appendDiagnosticsAlertingLocalSmoke(context);

    expect(context.checks[0]).toMatchObject({
      name: "diagnostics_alerting_local_smoke",
      status: "fail",
    });
    expect(context.issues).toContain("diagnostics_alerting_local_smoke is not ready.");
    expect(context.issues).toContain("Diagnostics alert webhook did not receive a signed test alert.");
    expect(context.actions).toContain("Inspect diagnostics alerting local stack logs.");
  });

  test("can be skipped for scoped release troubleshooting", async () => {
    const context = contextWith({ enabled: false });

    await appendDiagnosticsAlertingLocalSmoke(context);

    expect(context.checks).toEqual([{
      name: "diagnostics_alerting_local_smoke",
      status: "pass",
      details: { skipped: true },
    }]);
  });
});

function contextWith(overrides = {}) {
  const checks = [];
  const issues = [];
  const actions = [];
  return {
    enabled: true,
    root: "/repo",
    timeoutMs: 1000,
    checks,
    issues,
    actions,
    record: (target, name, ok, details = {}) =>
      target.push({ name, status: ok ? "pass" : "fail", details }),
    normalizeIssues: (value) => Array.isArray(value) ? value : [],
    ...overrides,
  };
}
