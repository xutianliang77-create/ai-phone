import { releaseDistribution, isPublicReleaseEndpoint } from "@translation/platform-security";
import { normalizeBaseUrl } from "./domestic_release_http_checks.mjs";

export function releaseReadinessPolicy(options) {
  const issues = [];
  const capabilityProfile = options.capabilityProfile ?? null;
  const distribution = releaseDistribution(options.distributionChannel);
  const formalRelease = distribution.formal;
  const deferCallLink = formalRelease && capabilityProfile === "core_translation";
  issues.push(...distribution.issues);
  const providerAcceptanceDeferred = capabilityProfile === "core_translation";
  const supportedProfiles = ["core_translation", "commercial_full"];
  if (capabilityProfile && !supportedProfiles.includes(capabilityProfile)) {
    issues.push(`invalid domestic release capability profile ${capabilityProfile}`);
  }
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const gatewayBaseUrl = normalizeBaseUrl(options.gatewayBaseUrl);
  const pstnBridgeBaseUrl = normalizeBaseUrl(options.pstnBridgeBaseUrl);
  if (formalRelease) {
    if (!capabilityProfile) issues.push("App Store release requires explicit capability profile");
    if (capabilityProfile !== "core_translation") issues.push("Formal 1.0 requires the approved core_translation profile");
    for (const [name, value] of [["apiBaseUrl", apiBaseUrl], ["gatewayBaseUrl", gatewayBaseUrl]]) {
      if (!isPublicReleaseEndpoint(value, ["https:"])) issues.push(`App Store release requires public secure ${name}`);
    }
    for (const key of ["checkReleaseMaterials", "checkReleaseEnvFile", "checkDiagnosticsAlertingLocalSmoke", "checkModelSelection", "checkModelRouting", "checkTtsProvider"]) {
      if (options[key] === false) issues.push(`App Store release cannot skip ${key}`);
    }
  }

  return { issues, capabilityProfile, distribution, formalRelease, deferCallLink,
    providerAcceptanceDeferred, apiBaseUrl, gatewayBaseUrl, pstnBridgeBaseUrl };
}
