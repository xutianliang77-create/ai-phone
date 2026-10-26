import { describe, expect, it } from "vitest";
import { checkIosDistribution } from "./ios_distribution_policy.mjs";

function candidate() {
  return { channel: "app_store", buildMode: "release", productProfile: "core_translation",
    signingIdentity: "Apple Distribution: Publisher", nowMs: Date.parse("2026-10-26T00:00:00Z"),
    info: { CFBundleIdentifier: "cn.publisher.translator", CFBundleShortVersionString: "1.0.0", WujieProductProfile: "core_translation",
      WujieDistributionChannel: "app_store", NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: false } },
    profile: { ExpirationDate: "2027-01-01T00:00:00Z", TeamIdentifier: ["FIXTURETEAM"], ApplicationIdentifierPrefix: ["TEAM"], Entitlements: { "application-identifier": "TEAM.cn.publisher.translator", "com.apple.developer.team-identifier": "FIXTURETEAM", "get-task-allow": false, "beta-reports-active": true } },
    signedEntitlements: { "application-identifier": "TEAM.cn.publisher.translator", "com.apple.developer.team-identifier": "FIXTURETEAM", "get-task-allow": false } };
}
describe("signed iOS channel eligibility", () => {
  it("accepts consistent distribution metadata without claiming store acceptance", () => {
    expect(checkIosDistribution(candidate())).toMatchObject({ status: "ready", qualification: "artifact_metadata_only_not_store_acceptance" });
  });
  it.each(["development", "ad_hoc", "enterprise"])("cannot promote a %s profile", (kind) => {
    const c = candidate();
    if (kind === "enterprise") c.profile.ProvisionsAllDevices = true;
    else c.profile.ProvisionedDevices = ["synthetic-device"];
    if (kind === "development") c.profile.Entitlements["get-task-allow"] = true;
    expect(checkIosDistribution(c).status).toBe("not_ready");
  });
  it.each(["signature", "bundle", "expiry", "transport", "channel", "build"])("rejects inconsistent %s", (kind) => {
    const c = candidate();
    if (kind === "signature") c.signedEntitlements["get-task-allow"] = true;
    if (kind === "bundle") c.profile.Entitlements["application-identifier"] = "TEAM.cn.someone.else";
    if (kind === "expiry") c.profile.ExpirationDate = "invalid";
    if (kind === "transport") c.info.NSAppTransportSecurity.NSAllowsArbitraryLoads = true;
    if (kind === "channel") c.info.WujieDistributionChannel = "restricted_instance";
    if (kind === "build") c.buildMode = "profile";
    expect(checkIosDistribution(c).status).toBe("not_ready");
  });
  it.each(["app_prefix", "signed_team", "profile_team"])("rejects a mismatched %s despite a matching Bundle suffix", (kind) => {
    const c = candidate();
    if (kind === "app_prefix") c.signedEntitlements["application-identifier"] = "OTHER.cn.publisher.translator";
    if (kind === "signed_team") c.signedEntitlements["com.apple.developer.team-identifier"] = "OTHERTEAM";
    if (kind === "profile_team") c.profile.TeamIdentifier = ["OTHERTEAM"];
    expect(checkIosDistribution(c).status).toBe("not_ready");
  });
});
