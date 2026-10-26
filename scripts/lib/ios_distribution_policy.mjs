export function checkIosDistribution(input) {
  const channel = input.channel ?? "restricted_instance";
  const issues = [];
  if (!["restricted_instance", "app_store"].includes(channel)) issues.push("Unknown iOS distribution channel");
  if (channel !== "app_store") return { status: issues.length ? "not_ready" : "ready", channel, issues };
  const { info = {}, profile = {}, signedEntitlements = {} } = input;
  const entitlements = profile.Entitlements ?? {};
  const require = (ok, message) => { if (!ok) issues.push(message); };
  require(info.CFBundleShortVersionString === "1.0.0", "Formal 1.0 product version must match");
  require(input.buildMode === "release", "App Store requires Release build mode");
  require(input.productProfile === "core_translation" && info.WujieProductProfile === "core_translation", "Formal 1.0 requires the approved core profile");
  require(info.WujieDistributionChannel === "app_store", "Signed distribution channel differs from requested channel");
  const ats = info.NSAppTransportSecurity ?? {};
  require(ats.NSAllowsArbitraryLoads === false && ats.NSAllowsLocalNetworking === false, "Formal iOS transport exceptions must be disabled");
  require(!Object.hasOwn(profile, "ProvisionedDevices") && profile.ProvisionsAllDevices !== true, "Development, Ad Hoc and enterprise profiles cannot be promoted to App Store");
  require(entitlements["get-task-allow"] === false && signedEntitlements["get-task-allow"] === false, "Debug entitlement must be disabled in profile and signature");
  require(entitlements["beta-reports-active"] === true, "App Store provisioning profile required");
  require(/^(Apple Distribution|iPhone Distribution):/.test(input.signingIdentity ?? ""), "Distribution signing identity required");
  const bundleId = info.CFBundleIdentifier;
  require(typeof bundleId === "string" && bundleId.includes(".") && !bundleId.includes("example"), "Valid bundle identity required");
  for (const value of [entitlements["application-identifier"], signedEntitlements["application-identifier"]]) {
    require(typeof value === "string" && value.endsWith(`.${bundleId}`) && !value.includes("*"), "Provisioning and signature bundle identities must match");
  }
  require(entitlements["application-identifier"] === signedEntitlements["application-identifier"], "Full signed application identifier must match the profile");
  const team = entitlements["com.apple.developer.team-identifier"];
  require(typeof team === "string" && team.length > 0 && Array.isArray(profile.TeamIdentifier) &&
    profile.TeamIdentifier.includes(team) && signedEntitlements["com.apple.developer.team-identifier"] === team,
    "Profile and signed team identities must match");
  const appIdentifier = entitlements["application-identifier"];
  const prefix = typeof appIdentifier === "string" ? appIdentifier.slice(0, -(String(bundleId).length + 1)) : null;
  require(Array.isArray(profile.ApplicationIdentifierPrefix) && profile.ApplicationIdentifierPrefix.includes(prefix), "Application identifier prefix must belong to the profile");
  require(Number.isFinite(Date.parse(profile.ExpirationDate)) && Date.parse(profile.ExpirationDate) > (input.nowMs ?? Date.now()), "Provisioning profile expired or invalid");
  return { status: issues.length ? "not_ready" : "ready", channel, issues,
    qualification: "artifact_metadata_only_not_store_acceptance" };
}
