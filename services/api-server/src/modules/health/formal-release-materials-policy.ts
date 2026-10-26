import { isPublicReleaseEndpoint } from "@translation/platform-security";
import type { ReleaseMaterialsManifest } from "./release-materials-readiness-schema.js";

export function formalMaterialIssues(manifest: ReleaseMaterialsManifest, formal: boolean) {
  const issues: string[] = [];
  if (formal && manifest.appIcpFiling === "京ICP备00000000号-1A") {
    issues.push("formal release cannot use a draft APP ICP filing");
  }
  if (formal && manifest.versionName !== "1.0.0") {
    issues.push("formal 1.0 materials version must match");
  }
  if (formal) {
    for (const field of ["privacyPolicyUrl", "userAgreementUrl", "accountDeletionUrl"] as const) {
      if (!isPublicReleaseEndpoint(manifest[field], ["https:"])) issues.push(`formal release invalid ${field}`);
    }
  }
  return issues;
}
