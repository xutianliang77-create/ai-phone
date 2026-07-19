import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const HA_MODES = new Set(["managed_ha", "patroni_etcd"]);
const WAL_MODES = new Set(["provider_managed_object_storage", "wal_g_object_storage"]);
const HA_COMMANDS = [
  "baseline",
  "triggerFailover",
  "verifyFencing",
  "verifyEndpoint",
  "rebuildOldPrimary",
];
const WAL_COMMANDS = [
  "createBaseBackup",
  "verifyArchive",
  "restoreOffHost",
  "verifyRestore",
];

export function loadPostgresResilienceDrillConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const file = path.resolve(
    root,
    options.file ?? "infra/postgres/production-resilience/drill.json",
  );
  if (!existsSync(file)) return output(file, [`Resilience drill config missing: ${file}`]);
  let config;
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return output(file, ["Resilience drill config is not valid JSON"]);
  }
  const checked = validatePostgresResilienceDrillConfig(config);
  return output(file, checked.issues, config);
}

export function validatePostgresResilienceDrillConfig(config) {
  const issues = [];
  if (config?.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (config?.environment !== "staging") {
    issues.push("Resilience drill must use isolated staging");
  }
  for (const field of ["topologyFile", "capacityResultFile"]) {
    if (!safeRelativePath(config?.[field])) issues.push(`${field} must be repository-relative`);
  }
  validateSafety(config?.safety, issues);
  validateObjectives(config?.objectives, issues);
  validateHa(config?.ha, issues);
  validateWal(config?.wal, issues);
  return output(null, issues, config);
}

function validateSafety(safety, issues) {
  if (!safety || typeof safety !== "object") {
    issues.push("safety configuration is required");
    return;
  }
  if (!/^[A-Z0-9_:-]{12,80}$/.test(safety.acknowledgement ?? "")) {
    issues.push("safety acknowledgement is invalid");
  }
  if (safety.sourceDatabase !== "ai_phone_staging") {
    issues.push("sourceDatabase must remain ai_phone_staging");
  }
  if (!/^ai_phone_restore_[a-z0-9_]{4,48}$/.test(safety.restoreDatabase ?? "") ||
    safety.restoreDatabase === safety.sourceDatabase) {
    issues.push("restoreDatabase must be a dedicated isolated database");
  }
  if (safety.tlsMode !== "verify-full") issues.push("PostgreSQL TLS must be verify-full");
  if (safety.allowAutomaticFailover !== true || safety.allowRestoreTargetCreation !== true) {
    issues.push("Failover and isolated restore must be explicitly enabled");
  }
  if (!integer(safety.gracefulDrainSeconds, 5, 300)) {
    issues.push("gracefulDrainSeconds must be 5-300");
  }
}

function validateObjectives(objectives, issues) {
  if (!integer(objectives?.maxRpoSeconds, 0, 300)) {
    issues.push("maxRpoSeconds must be 0-300");
  }
  if (!integer(objectives?.maxRtoSeconds, 30, 120)) {
    issues.push("maxRtoSeconds must be 30-120");
  }
}

function validateHa(ha, issues) {
  if (!HA_MODES.has(ha?.mode)) issues.push("Unsupported HA mode");
  const nodes = Array.isArray(ha?.nodes) ? ha.nodes : [];
  const hosts = new Set(nodes.map((node) => node?.hostId).filter(validId));
  const domains = new Set(nodes.map((node) => node?.failureDomain).filter(validId));
  if (nodes.length < 2 || hosts.size !== nodes.length || domains.size < 2) {
    issues.push("HA nodes must span distinct hosts and failure domains");
  }
  if (ha?.mode === "patroni_etcd" &&
    (!integer(ha?.dcsVoters, 3, 99) ||
      new Set(ha?.dcsFailureDomains ?? []).size < 3)) {
    issues.push("Patroni requires three DCS voters and failure domains");
  }
  validateCommands(ha?.commands, HA_COMMANDS, "HA", issues);
}

function validateWal(wal, issues) {
  if (!WAL_MODES.has(wal?.mode)) issues.push("Unsupported WAL mode");
  if (wal?.targetClass !== "off_host_object_storage") {
    issues.push("WAL target must be off-host object storage");
  }
  if (!integer(wal?.retentionDays, 30, 3650)) {
    issues.push("WAL retentionDays must be 30-3650");
  }
  if (wal?.requireEncryptionInTransit !== true ||
    wal?.requireEncryptionAtRest !== true || wal?.requireImmutability !== true) {
    issues.push("WAL encryption and immutability are mandatory");
  }
  validateCommands(wal?.commands, WAL_COMMANDS, "WAL", issues);
}

function validateCommands(commands, required, label, issues) {
  for (const name of required) {
    const command = commands?.[name];
    if (!command || typeof command.file !== "string" || !command.file.trim() ||
      command.file.includes("\0") || forbiddenShell(command.file) ||
      !Array.isArray(command.args) ||
      command.args.some((value) => typeof value !== "string" || value.includes("\0")) ||
      !validEnvironmentKeys(command.environmentKeys) ||
      !integer(command.timeoutSeconds, 5, 86_400)) {
      issues.push(`${label} command ${name} is invalid`);
    }
  }
}

function validEnvironmentKeys(keys) {
  return Array.isArray(keys) && keys.length <= 64 &&
    new Set(keys).size === keys.length &&
    keys.every((key) => /^[A-Z][A-Z0-9_]{0,79}$/.test(key));
}

function forbiddenShell(file) {
  return new Set([
    "sh", "bash", "zsh", "dash", "fish", "csh", "cmd", "powershell", "pwsh",
  ]).has(path.basename(file).toLowerCase());
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length > 0 &&
    !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..");
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{2,120}$/.test(value);
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function output(file, issues, config) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    file,
    issues,
    ...(config ? { config } : {}),
  };
}

export { HA_COMMANDS, WAL_COMMANDS };
