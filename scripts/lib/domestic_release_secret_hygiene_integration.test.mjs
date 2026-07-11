import { describe, expect, test } from "vitest";
import { checkDomesticReleaseReadiness } from "./domestic_release_readiness.mjs";
import {
  baseOptions,
  fakeFetch,
  readyMobileAppRelease,
} from "./domestic_release_readiness_test_helpers.mjs";

describe("domestic release secret hygiene gate", () => {
  test("blocks release when production secret files are not gitignored", async () => {
    const result = await checkDomesticReleaseReadiness({
      ...baseOptions(),
      checkSecretHygieneFn: () => ({
        status: "not_ready",
        gitignorePath: ".gitignore",
        checks: [
          {
            name: "gitignore:release/domestic/release.env",
            status: "fail",
          },
        ],
        issues: [
          "domestic secret hygiene missing ignore pattern: release/domestic/release.env",
        ],
        actions: [
          "Add domestic release secret files to .gitignore before filling production credentials.",
        ],
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
    expect(result.issues).toContain(
      "domestic_release_secret_hygiene is not ready.",
    );
    expect(result.issues).toContain(
      "domestic secret hygiene missing ignore pattern: release/domestic/release.env",
    );
  });
});
