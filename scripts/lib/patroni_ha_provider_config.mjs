import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._-]{2,120}$/;
const ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]{0,79}$/;

export function loadPatroniHaProviderConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const value = options.file ?? process.env.PATRONI_HA_PROVIDER_CONFIG_FILE;
  if (!value) throw new Error("PATRONI_HA_PROVIDER_CONFIG_FILE is required");
  const file = path.resolve(root, value);
  if (!existsSync(file)) throw new Error(`Patroni HA provider config missing: ${file}`);
  let config;
  try { config = JSON.parse(readFileSync(file, "utf8")); } catch {
    throw new Error("Patroni HA provider config is not valid JSON");
  }
  const issues = validatePatroniHaProviderConfig(config, { root });
  if (issues.length > 0) throw new Error(issues.join("; "));
  return { file, config };
}

export function validatePatroniHaProviderConfig(config, options = {}) {
  const root = options.root ?? process.cwd();
  const issues = [];
  if (config?.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (config?.environment !== "staging") issues.push("environment must be staging");
  if (!ID.test(config?.clusterName ?? "")) issues.push("clusterName is invalid");
  if (config?.sourceDatabase !== "ai_phone_staging") {
    issues.push("sourceDatabase must be ai_phone_staging");
  }
  validateExecutable(config?.patronictl, "patronictl", issues);
  validateExecutable(config?.psql, "psql", issues);
  validateEnvironmentKeys(config?.patroniEnvironmentKeys,
    "patroniEnvironmentKeys", issues);
  validateEnvironmentKeys(config?.databaseEnvironmentKeys,
    "databaseEnvironmentKeys", issues);
  if (!absoluteFile(config?.patroniConfigFile)) issues.push("patroniConfigFile is invalid");
  if (!safeRelative(config?.stateDirectory) ||
    !config?.stateDirectory?.startsWith("outputs/postgres-resilience/")) {
    issues.push("stateDirectory must be under outputs/postgres-resilience");
  }
  if (!table(config?.probeTable)) issues.push("probeTable is invalid");
  const nodes = Array.isArray(config?.nodes) ? config.nodes : [];
  if (nodes.length < 2 || new Set(nodes.map((node) => node?.id)).size !== nodes.length ||
    nodes.some((node) => !ID.test(node?.id ?? "") ||
      !ID.test(node?.failureDomain ?? "") || !ID.test(node?.pgService ?? "")) ||
    new Set(nodes.map((node) => node.failureDomain)).size < 2) {
    issues.push("nodes must identify two distinct hosts and failure domains");
  }
  if (!ID.test(config?.writerPgService ?? "") ||
    !nodes.some((node) => node.id === config?.failoverCandidateId)) {
    issues.push("writerPgService or failoverCandidateId is invalid");
  }
  validateController(config?.failureController, "failureController", issues);
  validateController(config?.recoveryController, "recoveryController", issues);
  validateController(config?.dcsController, "dcsController", issues);
  validateEnvironmentKeys(config?.requiredEnvironmentKeys,
    "requiredEnvironmentKeys", issues);
  const voters = Array.isArray(config?.dcsVoters) ? config.dcsVoters : [];
  if (voters.length < 3 || new Set(voters.map((voter) => voter?.id)).size !== voters.length ||
    voters.some((voter) => !ID.test(voter?.id ?? "") ||
      !ID.test(voter?.failureDomain ?? "")) ||
    new Set(voters.map((voter) => voter.failureDomain)).size < 3) {
    issues.push("dcsVoters must span at least three failure domains");
  }
  if (!integer(config?.pollIntervalMs, 100, 10_000) ||
    !integer(config?.failoverTimeoutSeconds, 30, 600) ||
    !integer(config?.rebuildTimeoutSeconds, 30, 3600)) {
    issues.push("poll and timeout settings are invalid");
  }
  const allowlisted = new Set([
    ...(config?.patroniEnvironmentKeys ?? []),
    ...(config?.databaseEnvironmentKeys ?? []),
    ...(config?.failureController?.environmentKeys ?? []),
    ...(config?.recoveryController?.environmentKeys ?? []),
    ...(config?.dcsController?.environmentKeys ?? []),
  ]);
  if ((config?.requiredEnvironmentKeys ?? []).some((key) => !allowlisted.has(key))) {
    issues.push("requiredEnvironmentKeys must be allowlisted by a provider component");
  }
  if (issues.length === 0) {
    for (const item of [config.patronictl.file, config.psql.file,
      config.patroniConfigFile, config.failureController.file,
      config.recoveryController.file, config.dcsController.file]) {
      if (!path.isAbsolute(item) || !path.resolve(item).startsWith(path.parse(item).root)) {
        issues.push(`Provider path is invalid: ${item}`);
      }
    }
    path.resolve(root, config.stateDirectory);
  }
  return issues;
}

function validateExecutable(value, label, issues) {
  if (!absoluteFile(value?.file) || !SHA256.test(value?.sha256 ?? "")) {
    issues.push(`${label} executable is invalid`);
  }
}

function validateController(value, label, issues) {
  if (!absoluteFile(value?.file) || !SHA256.test(value?.sha256 ?? "") ||
    !Array.isArray(value?.args) ||
    value.args.some((item) => typeof item !== "string" || item.includes("\0")) ||
    !Array.isArray(value?.environmentKeys) ||
    value.environmentKeys.some((key) => !ENVIRONMENT_KEY.test(key)) ||
    new Set(value.environmentKeys).size !== value.environmentKeys.length) {
    issues.push(`${label} is invalid`);
  }
}

function validateEnvironmentKeys(value, label, issues) {
  if (!Array.isArray(value) || value.length > 64 ||
    value.some((key) => !ENVIRONMENT_KEY.test(key)) ||
    new Set(value).size !== value.length) {
    issues.push(`${label} is invalid`);
  }
}

function absoluteFile(value) {
  return typeof value === "string" && path.isAbsolute(value) && !value.includes("\0");
}

function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes("..");
}

function table(value) {
  return typeof value === "string" &&
    /^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$/.test(value);
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}
