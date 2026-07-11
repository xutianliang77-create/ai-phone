import { existsSync, readFileSync } from "node:fs";

export function loadProvisioningRepairEvidence(
  repairJson,
  maxAgeHours,
  nowMs = Date.now(),
) {
  if (!existsSync(repairJson)) {
    return {
      path: repairJson,
      exists: false,
      pass: false,
      status: "missing",
      stage: "missing",
      freshness: "missing",
      issues: ["provisioning repair evidence file is missing"],
      actions: [
        "Run `DEVICE_ID=\"Wha的iPhone\" npm run ios:nemotron:repair-provisioning` after the iPhone is ready.",
      ],
    };
  }

  const payload = parseJson(readFileSync(repairJson, "utf8"));
  const generatedMs = Date.parse(payload?.generatedAt ?? "");
  const ageHours = Number.isFinite(generatedMs)
    ? (nowMs - generatedMs) / 36e5
    : null;
  const fresh = ageHours !== null &&
    ageHours >= 0 &&
    ageHours <= maxAgeHours;
  const statusPass = payload?.status === "pass";
  return {
    ...payload,
    path: repairJson,
    exists: true,
    pass: statusPass && fresh,
    freshness: fresh ? "fresh" : statusPass ? "stale" : "not_pass",
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    maxAgeHours,
    issues: repairIssues(payload),
    actions: repairActions(payload),
  };
}

function repairIssues(payload) {
  const issues = [];
  if (!payload) return ["provisioning repair evidence JSON is invalid"];
  if (payload.status !== "pass" && payload.message) issues.push(payload.message);
  for (const issue of payload.profileBefore?.issues ?? []) issues.push(issue);
  for (const issue of payload.profileAfter?.issues ?? []) issues.push(issue);
  return Array.from(new Set(issues));
}

function repairActions(payload) {
  const actions = [];
  for (const device of payload?.deviceDiagnostic?.devices ?? []) {
    for (const action of device.actions ?? []) actions.push(action);
  }
  for (const action of payload?.profileBefore?.actions ?? []) actions.push(action);
  for (const action of payload?.profileAfter?.actions ?? []) actions.push(action);
  if (actions.length === 0 && payload?.status !== "pass") {
    actions.push(
      "Enable iOS Developer Mode, keep the iPhone unlocked and trusted, then rerun provisioning repair.",
    );
  }
  return Array.from(new Set(actions));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
