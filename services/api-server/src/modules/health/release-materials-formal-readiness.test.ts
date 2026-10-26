import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getReleaseMaterialsReadinessForFile } from "./release-materials-readiness.js";
import { readyManifest, writeManifest } from "./release-materials-readiness-test-helpers.js";

describe("iOS-only free formal materials", () => {
  const dirs: string[] = [];
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL;
    process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL = "app_store";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL;
    else process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL = previous;
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  function materials(patch: Record<string, unknown> = {}) {
    return getReleaseMaterialsReadinessForFile(writeManifest(dirs, readyManifest({
      platforms: ["ios"], billingMode: "disabled", androidPackageId: undefined,
      versionName: "1.0.0",
      androidScreenshots: undefined, refundPolicyUrl: undefined, ...patch,
    })));
  }
  it("does not require deferred Android screenshots or a payment policy", () => {
    const result = materials();
    expect(result.status).toBe("ready");
    expect(result.checkedItems).not.toContain("android_screenshots");
    expect(result.checkedItems).not.toContain("refund_policy");
  });
  it("cannot promote the development placeholder filing", () => {
    expect(materials({ appIcpFiling: "京ICP备00000000号-1A" }).issues)
      .toContain("formal release cannot use a draft APP ICP filing");
  });
  it.each([{ platforms: undefined }, { platforms: ["ios", "android"] },
    { platforms: [] }, { billingMode: "iap" }, { billingMode: undefined },
    { privacyPolicyUrl: "https://127.0.0.1/privacy" }])("rejects unapproved scope or unsafe URLs %j", (patch) => {
    expect(materials(patch).status).toBe("not_ready");
  });
});
