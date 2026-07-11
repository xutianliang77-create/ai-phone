import { describe, expect, test } from "vitest";
import { checkDiagnosticsAlertingReadiness } from "./diagnostics_alerting_readiness.mjs";

describe("checkDiagnosticsAlertingReadiness", () => {
  test("passes when health is configured and alert-test is sent", async () => {
    const requests = [];
    const result = await checkDiagnosticsAlertingReadiness({
      apiBaseUrl: "http://127.0.0.1:3100",
      diagnosticsAdminToken: "admin-token",
      fetchFn: fakeFetch(requests),
    });

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(result.checks.map((check) => [check.name, check.status])).toEqual([
      ["diagnostics_admin_token_present", "pass"],
      ["diagnostics_health_configured", "pass"],
      ["diagnostics_alert_test_sent", "pass"],
    ]);
    expect(requests[1].headers.authorization).toBe("Bearer admin-token");
  });

  test("blocks missing admin token before calling the API", async () => {
    const requests = [];
    const result = await checkDiagnosticsAlertingReadiness({
      fetchFn: fakeFetch(requests),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "DIAGNOSTICS_ADMIN_TOKEN is required for diagnostics alerting readiness.",
    );
    expect(requests).toEqual([]);
  });

  test("reports incomplete diagnostics health", async () => {
    const result = await checkDiagnosticsAlertingReadiness({
      diagnosticsAdminToken: "admin-token",
      fetchFn: fakeFetch([], { webhook: "configuration_required" }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("Diagnostics health is not fully configured.");
    expect(result.checks.find((check) => check.name === "diagnostics_health_configured"))
      .toMatchObject({ status: "fail" });
  });

  test("reports failed alert-test delivery", async () => {
    const result = await checkDiagnosticsAlertingReadiness({
      diagnosticsAdminToken: "admin-token",
      fetchFn: fakeFetch([], { alertStatus: "failed", httpStatus: 503 }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("Diagnostics alert test was not delivered.");
    expect(result.checks.find((check) => check.name === "diagnostics_alert_test_sent"))
      .toMatchObject({ status: "fail" });
  });
});

function fakeFetch(requests, options = {}) {
  return async (url, init = {}) => {
    requests.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers ?? {},
    });
    const path = new URL(url).pathname;
    if (path === "/health") {
      return jsonResponse(200, {
        diagnostics: {
          adminQuery: options.adminQuery ?? "configured",
          webhook: options.webhook ?? "configured",
          onCall: options.onCall ?? "configured",
        },
      });
    }
    if (path === "/diagnostics/app-errors/alert-test") {
      const status = options.alertStatus ?? "sent";
      return jsonResponse(options.httpStatus ?? 200, {
        status,
        result: { status },
      });
    }
    return jsonResponse(404, { error: { message: `unexpected ${path}` } });
  };
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
