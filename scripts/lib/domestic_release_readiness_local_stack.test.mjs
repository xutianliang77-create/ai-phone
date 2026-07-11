import { describe, expect, test } from "vitest";
import { checkDomesticReleaseReadinessOnLocalStack } from "./domestic_release_readiness.mjs";
import { baseOptions, fakeFetch, readyMobileAppRelease } from "./domestic_release_readiness_test_helpers.mjs";

describe("checkDomesticReleaseReadinessOnLocalStack", () => {
  test("uses current-workspace local stack endpoints when requested", async () => {
    const requests = [];
    let localStackOptions = null;
    const result = await checkDomesticReleaseReadinessOnLocalStack({
      ...baseOptions(),
      internalApiSecret: undefined,
      withLocalStackFn: async (options, callback) => {
        localStackOptions = options;
        return callback({
          apiBaseUrl: "http://127.0.0.1:4410",
          gatewayBaseUrl: "http://127.0.0.1:4411",
          apiEnv: { INTERNAL_API_SECRET: "local-stack-secret" },
          options,
        });
      },
      fetchFn: fakeFetch(requests, {
        apiPort: "4410",
        gatewayPort: "4411",
      }),
      mobileAppReleaseCheckFn: readyMobileAppRelease,
      checkCallLinkWorkerFn: async (options) => ({
        status:
          options.apiBaseUrl === "http://127.0.0.1:4410" &&
          options.internalApiSecret === "local-stack-secret"
            ? "ready"
            : "not_ready",
        callId: "call-local",
        roomName: "call_call-local",
        checks: [],
        issues: [],
        actions: [],
      }),
    });

    expect(result.status).toBe("ready");
    expect(result.apiBaseUrl).toBe("http://127.0.0.1:4410");
    expect(result.gatewayBaseUrl).toBe("http://127.0.0.1:4411");
    expect(localStackOptions.releaseMaterialsFile).toBe(
      "release/domestic/release-materials.json",
    );
    expect(localStackOptions.modelRoutingFile).toBe(
      "release/domestic/model-routing.json",
    );
    expect(requests.some((request) => request.url.includes(":3100"))).toBe(false);
    expect(requests.some((request) => request.url.includes(":4410"))).toBe(true);
  });
});
