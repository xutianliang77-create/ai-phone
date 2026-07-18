import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._-]{2,120}$/;
const ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]{0,79}$/;
const STORAGE_PREFIXES = new Set(["WALG_S3_PREFIX", "WALG_GS_PREFIX", "WALG_AZ_PREFIX"]);

export function loadWalgBackupProviderConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const value = options.file ?? process.env.WALG_BACKUP_PROVIDER_CONFIG_FILE;
  if (!value) throw new Error("WALG_BACKUP_PROVIDER_CONFIG_FILE is required");
  const file = path.resolve(root, value);
  if (!existsSync(file)) throw new Error(`WAL-G provider config missing: ${file}`);
  let config;
  try { config = JSON.parse(readFileSync(file, "utf8")); } catch {
    throw new Error("WAL-G provider config is not valid JSON");
  }
  const issues = validateWalgBackupProviderConfig(config);
  if (issues.length > 0) throw new Error(issues.join("; "));
  return { file, config };
}

export function validateWalgBackupProviderConfig(config) {
  const issues = [];
  if (config?.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (config?.environment !== "staging") issues.push("environment must be staging");
  if (config?.sourceDatabase !== "ai_phone_staging") {
    issues.push("sourceDatabase must be ai_phone_staging");
  }
  if (!/^ai_phone_restore_[a-z0-9_]{4,48}$/.test(config?.restoreDatabase ?? "")) {
    issues.push("restoreDatabase must be an isolated ai_phone_restore database");
  }
  validateExecutable(config?.walG, "walG", issues);
  validateExecutable(config?.psql, "psql", issues);
  validateExecutable(config?.pgDump, "pgDump", issues);
  validateEnvironmentKeys(config?.walGEnvironmentKeys, "walGEnvironmentKeys", issues);
  validateEnvironmentKeys(config?.databaseEnvironmentKeys,
    "databaseEnvironmentKeys", issues);
  const prefixes = (config?.walGEnvironmentKeys ?? []).filter((key) =>
    STORAGE_PREFIXES.has(key));
  if (prefixes.length !== 1) {
    issues.push("walGEnvironmentKeys must select exactly one object-storage prefix");
  }
  if (!safePgData(config?.pgDataDirectory, false) ||
    !safePgData(config?.restoreDataDirectory, true) ||
    config?.pgDataDirectory === config?.restoreDataDirectory) {
    issues.push("PostgreSQL source and restore data directories are invalid");
  }
  if (!safeRelative(config?.stateDirectory) ||
    !config?.stateDirectory?.startsWith("outputs/postgres-resilience/")) {
    issues.push("stateDirectory must be under outputs/postgres-resilience");
  }
  if (!ID.test(config?.writerPgService ?? "") ||
    !ID.test(config?.restorePgService ?? "") ||
    config?.writerPgService === config?.restorePgService) {
    issues.push("writerPgService and restorePgService must be distinct");
  }
  validateController(config?.storageController, "storageController", issues);
  validateController(config?.recoveryController, "recoveryController", issues);
  validateEnvironmentKeys(config?.requiredEnvironmentKeys,
    "requiredEnvironmentKeys", issues);
  if (!integer(config?.retentionDays, 30, 3650) ||
    config?.requireEncryptionInTransit !== true ||
    config?.requireEncryptionAtRest !== true || config?.requireImmutability !== true) {
    issues.push("off-host encryption, immutability and retention are mandatory");
  }
  if (!integer(config?.backupTimeoutSeconds, 60, 86_400) ||
    !integer(config?.restoreTimeoutSeconds, 60, 86_400) ||
    !integer(config?.verifyTimeoutSeconds, 10, 3600)) {
    issues.push("WAL-G provider timeout settings are invalid");
  }
  const allowlisted = new Set([
    ...(config?.walGEnvironmentKeys ?? []),
    ...(config?.databaseEnvironmentKeys ?? []),
    ...(config?.storageController?.environmentKeys ?? []),
    ...(config?.recoveryController?.environmentKeys ?? []),
  ]);
  if ((config?.requiredEnvironmentKeys ?? []).some((key) => !allowlisted.has(key))) {
    issues.push("requiredEnvironmentKeys must be allowlisted by a provider component");
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
    value.args.some((item) => typeof item !== "string" || item.includes("\0"))) {
    issues.push(`${label} is invalid`);
    return;
  }
  validateEnvironmentKeys(value.environmentKeys, `${label}.environmentKeys`, issues);
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

function safePgData(value, restore) {
  return absoluteFile(value) && value !== path.parse(value).root &&
    (!restore || path.basename(value).startsWith("ai_phone_restore_"));
}

function safeRelative(value) {
  return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes("..");
}

function integer(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}
