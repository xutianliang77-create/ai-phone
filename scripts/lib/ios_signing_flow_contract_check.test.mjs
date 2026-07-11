import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkIosSigningFlowContract } from "./ios_signing_flow_contract_check.mjs";

let tempDir = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("checkIosSigningFlowContract", () => {
  test("passes when provisioning repair and signed build evidence are wired", () => {
    tempDir = makeProject();

    expect(checkIosSigningFlowContract(tempDir)).toMatchObject({
      status: "ready",
      failures: [],
    });
  });

  test("fails when repair no longer allows device registration", () => {
    tempDir = makeProject({
      repair: "DEVICE_ID is required for provisioning repair\ncheck_ios_provisioning_profile.mjs",
    });

    const result = checkIosSigningFlowContract(tempDir);

    expect(result.status).toBe("not_ready");
    expect(result.failures.map((failure) => failure.label)).toContain(
      "repair allows device registration",
    );
  });
});

function makeProject(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ios-signing-flow-"));
  write(root, "scripts/ios_nemotron_repair_provisioning.sh", overrides.repair ?? `
DEVICE_ID is required for provisioning repair
check_ios_provisioning_profile.mjs
diagnose_ios_device.mjs
--require-ready --json
selected_udid
-destination "id=$UDID"
-allowProvisioningUpdates
-allowProvisioningDeviceRegistration
PROFILE_BEFORE_JSON
PROFILE_AFTER_JSON
REPAIR_JSON
`);
  write(root, "scripts/ios_nemotron_local_preflight.sh", `
IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD
SIGNED_BUILD_JSON
SIGNED_BUILD_LOG
write_signed_build_json running
build ios --debug --no-pub
write_signed_build_json pass
write_signed_build_json fail
signedBuildDiagnosis
`);
  write(root, "scripts/check_ios_provisioning_profile.mjs", `
developmentTeam
productBundleIdentifier
selectedUdid(device)
ProvisionedDevices
ExpirationDate
teamMatches
bundleMatches
Regenerate the iOS App Development provisioning profile
`);
  write(root, "scripts/lib/ios_nemotron_signed_build_evidence.mjs", `
waiting for physical_iphone_readiness
signed build evidence missing
signed build evidence is stale
evidence.status !== "pass"
signed iPhoneOS build passed
`);
  write(root, "scripts/lib/ios_nemotron_provisioning_repair_evidence.mjs", `
provisioning repair evidence file is missing
repairIssues
repairActions
payload.status !== "pass"
`);
  write(root, "scripts/lib/ios_nemotron_acceptance_summary.mjs", `
provisioningRepair
signedBuild
input.provisioningRepairEvidence.issues
input.signedBuildEvidence.issues
`);
  return root;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
