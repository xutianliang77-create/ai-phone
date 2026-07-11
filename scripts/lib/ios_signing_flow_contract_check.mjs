import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function checkIosSigningFlowContract(root) {
  const checks = [];
  requireContains(checks, root, "scripts/ios_nemotron_repair_provisioning.sh", [
    ["DEVICE_ID is required for provisioning repair", "repair requires device id"],
    ["check_ios_provisioning_profile.mjs", "repair checks existing profiles"],
    ["diagnose_ios_device.mjs", "repair checks iPhone readiness"],
    ["--require-ready --json", "repair requires ready iPhone JSON"],
    ["selected_udid", "repair resolves selected UDID"],
    ["-destination \"id=$UDID\"", "repair targets selected device"],
    ["-allowProvisioningUpdates", "repair allows provisioning updates"],
    ["-allowProvisioningDeviceRegistration", "repair allows device registration"],
    ["PROFILE_BEFORE_JSON", "repair records profile before state"],
    ["PROFILE_AFTER_JSON", "repair records profile after state"],
    ["REPAIR_JSON", "repair writes structured evidence"],
  ]);
  requireContains(checks, root, "scripts/ios_nemotron_local_preflight.sh", [
    ["IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD", "preflight has signed build switch"],
    ["SIGNED_BUILD_JSON", "preflight writes signed build JSON"],
    ["SIGNED_BUILD_LOG", "preflight writes signed build log"],
    ["write_signed_build_json running", "preflight records signed build start"],
    ["build ios --debug --no-pub", "preflight runs signed iPhone build"],
    ["write_signed_build_json pass", "preflight records signed build pass"],
    ["write_signed_build_json fail", "preflight records signed build fail"],
    ["signedBuildDiagnosis", "preflight diagnoses signed build failures"],
  ]);
  requireContains(checks, root, "scripts/check_ios_provisioning_profile.mjs", [
    ["developmentTeam", "profile check reads Team ID"],
    ["productBundleIdentifier", "profile check reads bundle id"],
    ["selectedUdid(device)", "profile check reads selected UDID"],
    ["ProvisionedDevices", "profile check reads profile devices"],
    ["ExpirationDate", "profile check reads profile expiration"],
    ["teamMatches", "profile check validates Team"],
    ["bundleMatches", "profile check validates Bundle ID"],
    ["Regenerate the iOS App Development provisioning profile", "profile check gives repair action"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_signed_build_evidence.mjs", [
    ["waiting for physical_iphone_readiness", "signed build waits for ready iPhone"],
    ["signed build evidence missing", "signed build reports missing evidence"],
    ["signed build evidence is stale", "signed build rejects stale evidence"],
    ["evidence.status !== \"pass\"", "signed build rejects failed evidence"],
    ["signed iPhoneOS build passed", "signed build passes with evidence"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_provisioning_repair_evidence.mjs", [
    ["provisioning repair evidence file is missing", "repair evidence reports missing file"],
    ["repairIssues", "repair evidence summarizes issues"],
    ["repairActions", "repair evidence summarizes actions"],
    ["payload.status !== \"pass\"", "repair evidence rejects failed status"],
  ]);
  requireContains(checks, root, "scripts/lib/ios_nemotron_acceptance_summary.mjs", [
    ["provisioningRepair", "summary includes provisioning repair source"],
    ["signedBuild", "summary includes signed build source"],
    ["input.provisioningRepairEvidence.issues", "summary includes repair issues"],
    ["input.signedBuildEvidence.issues", "summary includes signed build issues"],
  ]);

  const failures = checks.filter((check) => !check.pass);
  return {
    schemaVersion: 1,
    status: failures.length === 0 ? "ready" : "not_ready",
    checks,
    failures,
  };
}

function requireContains(checks, root, relativePath, definitions) {
  const file = path.join(root, relativePath);
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!content) {
    checks.push({
      file: relativePath,
      label: "file exists",
      pass: false,
      issue: `${relativePath} is missing or empty`,
    });
    return;
  }
  for (const [needle, label] of definitions) {
    const pass = content.includes(needle);
    checks.push({
      file: relativePath,
      label,
      pass,
      issue: pass ? null : `${relativePath} missing ${needle}`,
    });
  }
}
