import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from
  "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { validatePatroniHaProviderConfig } from "./patroni_ha_provider_config.mjs";
import { validatePostgresResilienceDrillConfig } from
  "./postgres_resilience_drill_config.mjs";
import { validateWalgBackupProviderConfig } from "./walg_backup_provider_config.mjs";

const HA_STEPS = {
  baseline: "baseline",
  triggerFailover: "trigger-failover",
  verifyFencing: "verify-fencing",
  verifyEndpoint: "verify-endpoint",
  rebuildOldPrimary: "rebuild-old-primary",
};
const WAL_STEPS = {
  createBaseBackup: "create-base-backup",
  verifyArchive: "verify-archive",
  restoreOffHost: "restore-off-host",
  verifyRestore: "verify-restore",
};

export function checkPostgresResilienceProviderReadiness(options = {}) {
  const root = options.root ?? process.cwd();
  const environment = options.environment ?? process.env;
  const files = {
    drill: path.resolve(root, options.drillFile ??
      "infra/postgres/production-resilience/drill.json"),
    patroni: path.resolve(root, options.patroniFile ??
      environment.PATRONI_HA_PROVIDER_CONFIG_FILE ?? ""),
    walg: path.resolve(root, options.walgFile ??
      environment.WALG_BACKUP_PROVIDER_CONFIG_FILE ?? ""),
  };
  const issues = [];
  const drill = readConfig(files.drill, "drill", issues);
  const patroni = readConfig(files.patroni, "Patroni provider", issues);
  const walg = readConfig(files.walg, "WAL-G provider", issues);
  if (drill) issues.push(...validatePostgresResilienceDrillConfig(drill).issues);
  if (patroni) issues.push(...validatePatroniHaProviderConfig(patroni));
  if (walg) issues.push(...validateWalgBackupProviderConfig(walg));
  if (drill && patroni && walg && issues.length === 0) {
    checkPrivateConfig(files, issues);
    checkBindings(root, drill, patroni, walg, issues);
    checkArtifacts(drill, patroni, walg, issues);
    checkConfigEnvironment(files, environment, issues);
    checkEnvironment([...patroni.requiredEnvironmentKeys,
      ...walg.requiredEnvironmentKeys], environment, issues);
    checkEnvironmentFiles(environment, issues);
    checkPgServices(patroni, walg, environment, issues);
    checkDirectories(walg, issues);
    checkControllerRouting(patroni, walg, issues);
  }
  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "ready" : "not_ready",
    environment: "staging",
    files,
    checks: {
      noExternalMutation: true,
      sourceDatabase: patroni?.sourceDatabase,
      restoreDatabase: walg?.restoreDatabase,
      haMode: drill?.ha?.mode,
      walMode: drill?.wal?.mode,
    },
    issues: [...new Set(issues)],
  };
}

function checkConfigEnvironment(files, environment, issues) {
  for (const [key, file] of [
    ["PATRONI_HA_PROVIDER_CONFIG_FILE", files.patroni],
    ["WALG_BACKUP_PROVIDER_CONFIG_FILE", files.walg],
  ]) {
    if (!environment[key] || path.resolve(environment[key]) !== file) {
      issues.push(`${key} must resolve to the checked private config`);
    }
  }
}

function checkBindings(root, drill, patroni, walg, issues) {
  if (drill.ha.mode !== "patroni_etcd" || drill.wal.mode !== "wal_g_object_storage") {
    issues.push("Drill must bind patroni_etcd and wal_g_object_storage");
  }
  if (drill.safety.sourceDatabase !== patroni.sourceDatabase ||
    drill.safety.sourceDatabase !== walg.sourceDatabase ||
    drill.safety.restoreDatabase !== walg.restoreDatabase) {
    issues.push("Drill and provider database identities do not match");
  }
  if (drill.wal.retentionDays !== walg.retentionDays) {
    issues.push("Drill and WAL-G retention do not match");
  }
  const haNodes = drill.ha.nodes.map((value) => `${value.hostId}:${value.failureDomain}`);
  const providerNodes = patroni.nodes.map((value) => `${value.id}:${value.failureDomain}`);
  if (!sameSet(haNodes, providerNodes)) issues.push("Drill and Patroni HA nodes do not match");
  const dcsDomains = patroni.dcsVoters.map((value) => value.failureDomain);
  if (drill.ha.dcsVoters !== patroni.dcsVoters.length ||
    !sameSet(drill.ha.dcsFailureDomains, dcsDomains)) {
    issues.push("Drill and Patroni DCS topology do not match");
  }
  checkCommands(root, drill.ha.commands, HA_STEPS, "scripts/run_patroni_ha_provider.mjs",
    patroniCommandKeys(patroni), issues);
  checkCommands(root, drill.wal.commands, WAL_STEPS, "scripts/run_walg_backup_provider.mjs",
    walgCommandKeys(walg), issues);
}

function checkCommands(root, commands, steps, script, environmentKeys, issues) {
  for (const [name, step] of Object.entries(steps)) {
    const command = commands[name];
    if (!path.isAbsolute(command.file) || !sameArray(command.args,
      [script, step, "--json"])) {
      issues.push(`Provider command ${name} is not bound to ${script}`);
    }
    if (!sameSet(command.environmentKeys, environmentKeys[name])) {
      issues.push(`Provider command ${name} environment allowlist is not minimal`);
    }
    checkExecutable(command.file, undefined, `command ${name}`, issues);
    const resolvedScript = path.resolve(root, command.args[0] ?? "");
    if (!existsSync(resolvedScript)) issues.push(`Provider script is missing: ${script}`);
  }
}

function patroniCommandKeys(config) {
  const base = ["PATRONI_HA_PROVIDER_CONFIG_FILE"];
  const patroni = config.patroniEnvironmentKeys;
  const database = config.databaseEnvironmentKeys;
  return {
    baseline: unique([...base, ...patroni, ...database,
      ...config.dcsController.environmentKeys]),
    triggerFailover: unique([...base, ...patroni, ...database,
      ...config.failureController.environmentKeys]),
    verifyFencing: unique([...base, ...patroni, ...database]),
    verifyEndpoint: unique([...base, ...patroni, ...database]),
    rebuildOldPrimary: unique([...base, ...patroni,
      ...config.recoveryController.environmentKeys]),
  };
}

function walgCommandKeys(config) {
  const base = ["WALG_BACKUP_PROVIDER_CONFIG_FILE"];
  const walg = config.walGEnvironmentKeys;
  const database = config.databaseEnvironmentKeys;
  return {
    createBaseBackup: unique([...base, ...walg,
      ...config.storageController.environmentKeys]),
    verifyArchive: unique([...base, ...walg, ...database,
      ...config.storageController.environmentKeys]),
    restoreOffHost: unique([...base, ...walg,
      ...config.recoveryController.environmentKeys]),
    verifyRestore: unique([...base, ...database,
      ...config.recoveryController.environmentKeys]),
  };
}

function checkArtifacts(drill, patroni, walg, issues) {
  for (const [label, value] of Object.entries({
    patronictl: patroni.patronictl,
    psql: patroni.psql,
    walGPostgresClient: walg.psql,
    dcsController: patroni.dcsController,
    failureController: patroni.failureController,
    recoveryController: patroni.recoveryController,
    walG: walg.walG,
    pgDump: walg.pgDump,
    storageController: walg.storageController,
    walRecoveryController: walg.recoveryController,
  })) checkExecutable(value.file, value.sha256, label, issues);
  checkRegularFile(patroni.patroniConfigFile, "Patroni config", issues);
  for (const group of [drill.ha.commands, drill.wal.commands]) {
    for (const command of Object.values(group)) {
      checkExecutable(command.file, undefined, "provider command runtime", issues);
    }
  }
}

function checkEnvironment(keys, environment, issues) {
  for (const key of new Set(keys)) {
    if (typeof environment[key] !== "string" || environment[key].length === 0) {
      issues.push(`Required provider environment is missing: ${key}`);
    }
  }
}

function checkEnvironmentFiles(environment, issues) {
  for (const key of ["PGSERVICEFILE", "PGPASSFILE", "PGSSLROOTCERT",
    "AWS_S3_CA_CERT_FILE", "GOOGLE_APPLICATION_CREDENTIALS"]) {
    if (!environment[key]) continue;
    checkRegularFile(environment[key], key, issues);
    if (key === "PGPASSFILE" && existsSync(environment[key]) &&
      (statSync(environment[key]).mode & 0o077) !== 0) {
      issues.push("PGPASSFILE must not grant group or world permissions");
    }
  }
}

function checkPgServices(patroni, walg, environment, issues) {
  if (!environment.PGSERVICEFILE || !existsSync(environment.PGSERVICEFILE)) return;
  const services = parseIni(readFileSync(environment.PGSERVICEFILE, "utf8"));
  const expected = new Map([
    [patroni.writerPgService, patroni.sourceDatabase],
    ...patroni.nodes.map((node) => [node.pgService, patroni.sourceDatabase]),
    [walg.writerPgService, walg.sourceDatabase],
    [walg.restorePgService, walg.restoreDatabase],
  ]);
  for (const [name, database] of expected) {
    const service = services[name];
    if (!service || service.sslmode !== "verify-full" ||
      service.dbname !== database || !service.host ||
      !(service.sslrootcert || environment.PGSSLROOTCERT)) {
      issues.push(`PostgreSQL service ${name} is not bound to ${database} with verify-full`);
    }
  }
}

function parseIni(value) {
  const result = {};
  let section;
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const heading = line.match(/^\[([^\]]+)\]$/);
    if (heading) {
      section = heading[1];
      result[section] = result[section] ?? {};
      continue;
    }
    const separator = line.indexOf("=");
    if (section && separator > 0) {
      result[section][line.slice(0, separator).trim()] =
        line.slice(separator + 1).trim();
    }
  }
  return result;
}

function checkDirectories(config, issues) {
  if (!existsSync(config.pgDataDirectory) || !statSync(config.pgDataDirectory).isDirectory()) {
    issues.push("WAL-G source PGDATA directory is missing");
  }
  if (existsSync(config.restoreDataDirectory) &&
    (!statSync(config.restoreDataDirectory).isDirectory() ||
      readdirSync(config.restoreDataDirectory).length > 0)) {
    issues.push("WAL-G restore PGDATA must be an empty directory or absent");
  }
  const parent = path.dirname(config.restoreDataDirectory);
  try { accessSync(parent, constants.W_OK); } catch {
    issues.push("WAL-G restore parent directory is not writable");
  }
}

function checkControllerRouting(patroni, walg, issues) {
  requireArgs(patroni.dcsController, ["--json"], "DCS controller", issues);
  requireArgs(patroni.failureController, ["{oldPrimaryId}", "--json"],
    "failure controller", issues);
  requireArgs(patroni.recoveryController, ["{oldPrimaryId}", "--json"],
    "HA recovery controller", issues);
  requireArgs(walg.storageController, ["{action}", "--json"],
    "storage controller", issues);
  requireArgs(walg.recoveryController, ["{action}", "--json"],
    "WAL recovery controller", issues);
}

function checkPrivateConfig(files, issues) {
  for (const [label, file] of Object.entries(files)) {
    if (/\.example\.json$/i.test(file)) issues.push(`${label} config cannot be an example file`);
    const value = readFileSync(file, "utf8");
    if (/"(?:password|secret|token|credential|privateKey|accessKey)"\s*:/i.test(value)) {
      issues.push(`${label} config contains an inline secret field`);
    }
  }
}

function checkExecutable(file, expectedSha256, label, issues) {
  if (!existsSync(file)) {
    issues.push(`${label} executable is missing: ${file}`);
    return;
  }
  const stat = statSync(file);
  if (!stat.isFile() || (stat.mode & 0o111) === 0) {
    issues.push(`${label} is not an executable file`);
  }
  if (expectedSha256 && sha256(file) !== expectedSha256) {
    issues.push(`${label} executable SHA-256 mismatch`);
  }
}

function checkRegularFile(file, label, issues) {
  if (!existsSync(file) || !statSync(file).isFile()) issues.push(`${label} file is missing`);
}

function readConfig(file, label, issues) {
  if (!file || !existsSync(file)) {
    issues.push(`${label} config is missing: ${file || "unset"}`);
    return null;
  }
  try { return JSON.parse(readFileSync(file, "utf8")); } catch {
    issues.push(`${label} config is not valid JSON`);
    return null;
  }
}

function requireArgs(controller, required, label, issues) {
  if (required.some((value) => !controller.args.includes(value))) {
    issues.push(`${label} argument routing is incomplete`);
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length &&
    left.every((value) => right.includes(value));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}
