import { describe, expect, it } from "vitest";
import { checkDomesticReleaseReadiness } from "./domestic_release_readiness.mjs";
import { baseOptions, fakeFetch, readyMobileAppRelease } from "./domestic_release_readiness_test_helpers.mjs";

function formalOptions(requests, remoteChannel = "app_store") {
  const http = fakeFetch(requests);
  return { ...baseOptions(), capabilityProfile: "core_translation", distributionChannel: "app_store",
    apiBaseUrl: "https://api.publisher.cn:3100", gatewayBaseUrl: "https://stream.publisher.cn:3101",
    mobileAppReleaseCheckFn: readyMobileAppRelease,
    checkDiagnosticsAlertingLocalSmoke: true,
    checkDiagnosticsAlertingLocalSmokeFn: async () => ({ status: "ready", checks: [], issues: [], actions: [] }),
    checkReleaseEnvFileFn: () => ({ status: "ready", distributionChannel: "app_store", issues: [], actions: [] }),
    fetchFn: async (url, init) => {
      const response = await http(url, init);
      if (new URL(url).port === "3100" && new URL(url).pathname === "/health/release-ready") {
        return new Response(JSON.stringify({ status: "ready", capabilityProfileReadiness: {
          profile: "core_translation", distributionChannel: remoteChannel,
        } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return response;
    },
  };
}
describe("formal aggregate cannot inherit private release shortcuts", () => {
  it("accepts configured simulated core checks without calling deferred room providers", async () => {
    const requests = [];
    const result = await checkDomesticReleaseReadiness(formalOptions(requests));
    expect(result.status).toBe("ready");
    expect(result.deferredCapabilities).toContain("call_link");
    expect(requests.some((r) => new URL(r.url).pathname.startsWith("/call-links"))).toBe(false);
    expect(result.checks.find((r) => r.name === "release_materials_readiness").status).toBe("pass");
  });
  it.each(["checkReleaseMaterials", "checkReleaseEnvFile", "checkDiagnosticsAlertingLocalSmoke", "checkModelSelection", "checkModelRouting", "checkTtsProvider"])(
    "cannot skip %s or reach any model after invalid preflight", async (key) => {
      const requests = [];
      const result = await checkDomesticReleaseReadiness({ ...formalOptions(requests), [key]: false });
      expect(result.status).toBe("not_ready");
      expect(result.issues).toContain(`App Store release cannot skip ${key}`);
      expect(requests).toHaveLength(0);
    });
  it("does not accept a private-channel server merely because it returns HTTP 200/ready", async () => {
    const result = await checkDomesticReleaseReadiness(formalOptions([], "restricted_instance"));
    expect(result.status).toBe("not_ready");
    expect(result.checks.find((r) => r.name === "api_release_ready").details.channelMatches).toBe(false);
  });
  it("rejects unsafe endpoints before requests and redacts credentials from the report", async () => {
    const requests = [];
    const result = await checkDomesticReleaseReadiness({ ...formalOptions(requests),
      apiBaseUrl: "https://user:private-password@api.publisher.cn?key=private-query" });
    expect(result.status).toBe("not_ready"); expect(requests).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("private-password");
    expect(JSON.stringify(result)).not.toContain("private-query");
  });
});
