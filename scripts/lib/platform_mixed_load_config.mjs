import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED_TRAFFIC = [
  "api", "livekit", "sip", "asr", "mt", "tts", "agent", "egress",
];
const PHASES = new Map([
  [25, 30],
  [50, 10],
  [100, 30],
]);
const FAILURE_PROFILES = new Map([
  ["translation_worker_sigkill", ["translation-worker", "sigkill"]],
  ["model_provider_timeout", ["model-provider", "timeout"]],
  ["livekit_node_drain", ["livekit", "node-drain"]],
]);

export function loadPlatformMixedLoadConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const file = path.resolve(
    root,
    options.file ?? "infra/platform-ha/mixed-load.json",
  );
  const issues = [];
  if (!existsSync(file)) {
    return result(file, [`Mixed-load config missing: ${file}`]);
  }
  let config;
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return result(file, ["Mixed-load config is not valid JSON"]);
  }
  validateConfig(config, issues, options.release !== false);
  return result(file, issues, config);
}

export function validatePlatformMixedLoadConfig(config, options = {}) {
  const issues = [];
  validateConfig(config, issues, options.release !== false);
  return result(null, issues, config);
}

function validateConfig(config, issues, release) {
  if (config?.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (config?.environment !== "staging") {
    issues.push("Mixed-load acceptance must use isolated staging");
  }
  if (!new Set(["real", "mock"]).has(config?.mode)) {
    issues.push("mode must be real or mock");
  }
  if (release && config?.mode !== "real") {
    issues.push("Release mixed-load acceptance requires real mode");
  }
  if (!safeRelativePath(config?.topologyFile)) {
    issues.push("topologyFile must be a safe repository-relative path");
  }
  validateSafety(config?.safety, config?.mode, issues);
  validateStages(config?.stages, issues);
  validateSoak(config?.soak, issues);
  validateAdmission(config?.admission, issues);
  validateSlo(config?.slo, issues);
  validateCommand(config?.systemProbe, "System probe", issues);
  validateScenarios(config?.scenarios, issues);
  validateFailures(config?.failureInjections, issues);
  const maximumConcurrency = Math.max(
    0,
    ...(config?.stages ?? []).map((stage) => Number(stage.concurrentSessions ?? 0)),
    Number(config?.soak?.concurrentSessions ?? 0),
    Number(config?.admission?.concurrentSessions ?? 0),
  );
  if (Number(config?.safety?.maxPendingStarts) < maximumConcurrency) {
    issues.push("maxPendingStarts must cover the largest concurrent phase");
  }
  const kinds = new Set(
    (config?.scenarios ?? []).flatMap((scenario) => scenario.trafficKinds ?? []),
  );
  for (const kind of REQUIRED_TRAFFIC) {
    if (!kinds.has(kind)) issues.push(`Scenario mix does not cover ${kind}`);
  }
}

function validateSafety(safety, mode, issues) {
  if (!safety || typeof safety !== "object") {
    issues.push("safety configuration is required");
    return;
  }
  if (!validUrl(safety.apiBaseUrl, mode === "real")) {
    issues.push("safety.apiBaseUrl must be an allowed staging endpoint");
  }
  const host = hostname(safety.apiBaseUrl);
  if (!Array.isArray(safety.allowedApiHosts) ||
    !safety.allowedApiHosts.includes(host)) {
    issues.push("API hostname must be explicitly allowlisted");
  }
  if (!/^[A-Z0-9_:-]{12,80}$/.test(safety.acknowledgement ?? "")) {
    issues.push("safety.acknowledgement is invalid");
  }
  if (!integer(safety.gracefulDrainSeconds, 5, 300)) {
    issues.push("gracefulDrainSeconds must be 5-300");
  }
  if (!integer(safety.maxPendingStarts, 1, 1000)) {
    issues.push("maxPendingStarts must be 1-1000");
  }
  if (!integer(safety.systemSampleDelaySeconds, 5, 300)) {
    issues.push("systemSampleDelaySeconds must be 5-300");
  }
}

function validateStages(stages, issues) {
  if (!Array.isArray(stages) || stages.length !== PHASES.size) {
    issues.push("stages must contain exactly 25, 50, and 100 sessions");
    return;
  }
  for (const [sessions, minimumMinutes] of PHASES) {
    const stage = stages.find((item) => item?.concurrentSessions === sessions);
    if (!stage || !integer(stage.durationMinutes, minimumMinutes, 1440)) {
      issues.push(`${sessions}-session stage duration is below ${minimumMinutes} minutes`);
    }
    if (stage && !integer(stage.rampUpSeconds, 0, 1800)) {
      issues.push(`${sessions}-session rampUpSeconds must be 0-1800`);
    }
  }
}

function validateSoak(soak, issues) {
  if (!soak || !integer(soak.concurrentSessions, 1, 10_000) ||
    !integer(soak.durationMinutes, 120, 2880) ||
    !finite(soak.targetUtilization, 0.65, 0.7)) {
    issues.push("soak requires sessions, >=120 minutes, and 0.65-0.70 utilization");
  }
}

function validateAdmission(admission, issues) {
  if (!admission || !integer(admission.concurrentSessions, 1, 10_000) ||
    !integer(admission.durationMinutes, 1, 120) ||
    !finite(admission.minimumObservedUtilization, 0.85, 1)) {
    issues.push("admission requires sessions, duration, and utilization >=0.85");
  }
}

function validateSlo(slo, issues) {
  if (!slo || !finite(slo.maxErrorRate, 0, 0.1) ||
    !integer(slo.p95SessionStartMs, 1, 120_000) ||
    !integer(slo.p95FinalLatencyMs, 1, 120_000) ||
    !finite(slo.minimumFinalCoverageRatio, 0.99, 1)) {
    issues.push("slo thresholds are incomplete or unsafe");
  }
}

function validateScenarios(scenarios, issues) {
  if (!Array.isArray(scenarios) || scenarios.length < 2) {
    issues.push("At least two mixed-load scenarios are required");
    return;
  }
  let totalWeight = 0;
  const names = new Set();
  for (const scenario of scenarios) {
    if (!validName(scenario?.name) || names.has(scenario.name)) {
      issues.push("Scenario names must be unique and normalized");
    }
    names.add(scenario?.name);
    if (!integer(scenario?.weight, 1, 100)) {
      issues.push(`Scenario ${scenario?.name ?? "unknown"} has invalid weight`);
    }
    totalWeight += Number(scenario?.weight ?? 0);
    if (!Array.isArray(scenario?.trafficKinds) || scenario.trafficKinds.length === 0 ||
      scenario.trafficKinds.some((kind) => !REQUIRED_TRAFFIC.includes(kind))) {
      issues.push(`Scenario ${scenario?.name ?? "unknown"} has invalid trafficKinds`);
    }
    validateCommand(scenario?.command, `Scenario ${scenario?.name ?? "unknown"}`, issues);
  }
  if (totalWeight !== 100) issues.push("Scenario weights must total 100");
}

function validateFailures(failures, issues) {
  if (!Array.isArray(failures) || failures.length === 0) {
    issues.push("At least one failure injection is required");
    return;
  }
  for (const failure of failures) {
    const profile = FAILURE_PROFILES.get(failure?.name);
    if (!validName(failure?.name) ||
      !profile || failure?.target !== profile[0] || failure?.fault !== profile[1] ||
      !new Set(["capacity-25", "capacity-50", "capacity-100", "soak", "admission"])
        .has(failure?.phase) ||
      !integer(failure?.atSeconds, 0, 10_800) ||
      !integer(failure?.recoveryTimeoutSeconds, 5, 1800)) {
      issues.push("Failure injection metadata is invalid");
    }
    validateCommand(failure?.command, `Failure ${failure?.name ?? "unknown"}`, issues);
  }
}

function validateCommand(command, label, issues) {
  if (!command || typeof command.file !== "string" || !command.file.trim() ||
    command.file.includes("\0") || forbiddenShell(command.file) ||
    !Array.isArray(command.args) ||
    command.args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    issues.push(`${label} command must use an executable and argument array`);
  }
}

function forbiddenShell(file) {
  return new Set([
    "sh", "bash", "zsh", "dash", "fish", "csh", "cmd", "powershell", "pwsh",
  ]).has(path.basename(file).toLowerCase());
}

function validUrl(value, requireTls) {
  try {
    const url = new URL(value);
    if (requireTls && url.protocol !== "https:") return false;
    if (!requireTls && !["http:", "https:"].includes(url.protocol)) return false;
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

function hostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function validName(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{2,63}$/.test(value);
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length > 0 &&
    !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..");
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function finite(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= minimum && value <= maximum;
}

function result(file, issues, config) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    file,
    issues,
    ...(config ? { config } : {}),
  };
}

export { REQUIRED_TRAFFIC };
