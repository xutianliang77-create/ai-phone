import { describe, expect, test } from "vitest";
import { checkDomesticReleaseReadiness } from "./domestic_release_readiness.mjs";
import { baseOptions, fakeFetch, readyMobileAppRelease } from "./domestic_release_readiness_test_helpers.mjs";

describe("domestic release model routing gate", () => {
  test("blocks release when model routing is not complete", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      modelRoutingCheckFn: () => ({
        status: "not_ready",
        filePath: "release/domestic/model-routing.json",
        checks: [{ name: "model_routing_active_profile", status: "fail" }],
        issues: ["Model routing activeProfile must exist."],
        actions: ["Fix model routing provider/model/env entries and rerun this check."],
      }),
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("model_routing_readiness is not ready.");
    expect(result.issues).toContain("Model routing activeProfile must exist.");
    expect(result.actions).toContain(
      "Fix model routing provider/model/env entries and rerun this check.",
    );
  });

  test("can skip model routing only for scoped local checks", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkModelRouting: false,
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      fetchFn: fakeFetch([]),
      checkCallLinkWorkerFn: async () => ({
        status: "ready",
        callId: "call-1",
        roomName: "call_call-1",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("ready");
    expect(
      result.checks.find((check) => check.name === "model_routing_readiness"),
    ).toMatchObject({ status: "pass", details: { skipped: true } });
  });
});
