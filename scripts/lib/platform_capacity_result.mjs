import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkPlatformTopology } from "./platform_topology_config.mjs";

export function checkPlatformCapacityResult(options = {}) {
  const root = options.root ?? process.cwd();
  const resultFile = path.resolve(
    root,
    options.file ?? "outputs/platform-capacity/latest.json",
  );
  const topologyFile = path.resolve(
    root,
    options.topology ?? "infra/platform-ha/topology.json",
  );
  const issues = [];
  const topology = checkPlatformTopology({
    root,
    file: topologyFile,
    release: true,
  });
  issues.push(...topology.issues);
  const result = readJson(resultFile, "Capacity result", issues);
  if (!result) return output(resultFile, topologyFile, issues);
  if (result.schemaVersion !== 1) issues.push("Capacity result schemaVersion must be 1");
  if (result.status !== "passed") issues.push("Capacity result status must be passed");
  if (result.environment !== "staging") {
    issues.push("Capacity acceptance must run in isolated staging");
  }
  if (!validRunId(result.runId)) issues.push("Capacity result runId is invalid");
  if (existsSync(topologyFile) && result.topologySha256 !== sha256(topologyFile)) {
    issues.push("Capacity result does not match the verified topology file");
  }
  checkStages(result.stages, issues);
  checkSoak(result.soak, issues);
  checkAdmission(result.admission, issues);
  checkTotals(result.totals, issues);
  if (result.failureInjection?.status !== "passed") {
    issues.push("Failure-injection acceptance did not pass");
  }
  checkEvidence(root, result.evidence, issues);
  return output(resultFile, topologyFile, issues, result);
}

function checkStages(stages, issues) {
  if (!Array.isArray(stages) || stages.length !== 3) {
    issues.push("Capacity stages must contain 25, 50, and 100 sessions");
    return;
  }
  const minimumMinutes = new Map([[25, 30], [50, 10], [100, 30]]);
  for (const [sessions, minutes] of minimumMinutes) {
    const stage = stages.find((item) => item.concurrentSessions === sessions);
    if (!stage || stage.status !== "passed" || stage.durationMinutes < minutes ||
      stage.sloPassed !== true) {
      issues.push(`${sessions}-session capacity stage did not pass`);
    }
  }
}

function checkSoak(soak, issues) {
  if (!soak || soak.status !== "passed" || soak.durationMinutes < 120 ||
    soak.targetUtilization > 0.7 || soak.targetUtilization < 0.65 ||
    soak.sloPassed !== true) {
    issues.push("70% utilization 120-minute soak did not pass");
  }
  const requiredTraffic = [
    "api", "livekit", "sip", "asr", "mt", "tts", "agent", "egress",
  ];
  if (soak?.realProviderTraffic !== true || !Array.isArray(soak?.trafficKinds) ||
    requiredTraffic.some((kind) => !soak.trafficKinds.includes(kind))) {
    issues.push("Soak must include real API/RTC/SIP/model/agent/egress traffic");
  }
}

function checkAdmission(admission, issues) {
  if (!admission || admission.status !== "passed" ||
    admission.observedUtilization < 0.85 || admission.rejectionObserved !== true ||
    admission.oomCount !== 0 || admission.unboundedQueueObserved !== false) {
    issues.push("85% overload admission-control gate did not pass");
  }
}

function checkTotals(totals, issues) {
  if (!totals || totals.providerSideEffectDuplicates !== 0 ||
    totals.lostFinalEvents !== 0 || totals.duplicateSettlements !== 0 ||
    totals.finalCoverageRatio < 0.99) {
    issues.push("Capacity totals violate side-effect or final-event invariants");
  }
}

function checkEvidence(root, evidence, issues) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    issues.push("Capacity evidence paths are required");
    return;
  }
  for (const value of evidence) {
    if (typeof value !== "string" || path.isAbsolute(value) || value.includes("..")) {
      issues.push("Capacity evidence paths must be safe repository-relative paths");
      continue;
    }
    if (!existsSync(path.resolve(root, value))) {
      issues.push(`Capacity evidence is missing: ${value}`);
    }
  }
}

function readJson(file, label, issues) {
  if (!existsSync(file)) {
    issues.push(`${label} missing: ${file}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    issues.push(`${label} is not valid JSON`);
    return null;
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function validRunId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

function output(file, topologyFile, issues, result) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    file,
    topologyFile,
    issues,
    ...(result ? { result } : {}),
  };
}
