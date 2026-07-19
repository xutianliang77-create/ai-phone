import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPostgresResilienceProviderReadiness } from
  "./postgres_resilience_provider_readiness.mjs";

describe("checkPostgresResilienceProviderReadiness", () => {
  it("accepts a fully bound offline Patroni and WAL-G staging configuration", () => {
    const fixture = createFixture();
    expect(checkPostgresResilienceProviderReadiness(fixture.options)).toMatchObject({
      status: "ready",
      issues: [],
      checks: { noExternalMutation: true, haMode: "patroni_etcd",
        walMode: "wal_g_object_storage" },
    });
  });

  it("rejects missing secrets, excessive command scope and unsafe restore state", () => {
    const fixture = createFixture();
    delete fixture.options.environment.STORAGE_TOKEN;
    fixture.drill.ha.commands.verifyFencing.environmentKeys.push("HA_TOKEN");
    writeJson(fixture.options.drillFile, fixture.drill);
    mkdirSync(fixture.walg.restoreDataDirectory);
    writeFileSync(path.join(fixture.walg.restoreDataDirectory, "unexpected"), "data");
    fixture.patroni.recoveryController.args = ["recover", "--json"];
    writeJson(fixture.options.patroniFile, fixture.patroni);
    const result = checkPostgresResilienceProviderReadiness(fixture.options);
    expect(result.status).toBe("not_ready");
    expect(result.issues).toEqual(expect.arrayContaining([
      "Required provider environment is missing: STORAGE_TOKEN",
      "Provider command verifyFencing environment allowlist is not minimal",
      "WAL-G restore PGDATA must be an empty directory or absent",
      "HA recovery controller argument routing is incomplete",
    ]));
  });
});

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "provider-readiness-"));
  mkdirSync(path.join(root, "scripts"));
  for (const file of ["run_patroni_ha_provider.mjs", "run_walg_backup_provider.mjs"]) {
    writeFileSync(path.join(root, "scripts", file), "export {};\n");
  }
  const tool = path.join(root, "provider-tool");
  writeFileSync(tool, "#!/bin/sh\nexit 0\n");
  chmodSync(tool, 0o755);
  const executable = { file: tool, sha256: sha256(tool) };
  const pgData = path.join(root, "ai_phone_staging");
  mkdirSync(pgData);
  const patroniConfig = path.join(root, "patroni.yml");
  writeFileSync(patroniConfig, "scope: staging\n");
  const files = Object.fromEntries(["pg_service.conf", ".pgpass", "postgres-ca.pem"]
    .map((name) => [name, path.join(root, name)]));
  for (const file of Object.values(files)) {
    writeFileSync(file, "fixture\n", { mode: 0o600 });
  }
  const patroni = patroniConfigValue(executable, patroniConfig);
  const walg = walgConfigValue(root, executable, pgData);
  writeFileSync(files["pg_service.conf"], pgServices(patroni, walg), { mode: 0o600 });
  const drill = drillConfig(patroni, walg);
  const drillFile = path.join(root, "drill.json");
  const patroniFile = path.join(root, "patroni-provider.json");
  const walgFile = path.join(root, "walg-provider.json");
  writeJson(drillFile, drill);
  writeJson(patroniFile, patroni);
  writeJson(walgFile, walg);
  const environment = {
    PATRONI_HA_PROVIDER_CONFIG_FILE: patroniFile,
    WALG_BACKUP_PROVIDER_CONFIG_FILE: walgFile,
    PATRONI_SECRET: "patroni-secret",
    PGSERVICEFILE: files["pg_service.conf"],
    PGPASSFILE: files[".pgpass"],
    PGSSLROOTCERT: files["postgres-ca.pem"],
    HA_TOKEN: "ha-token",
    WALG_S3_PREFIX: "s3://private/staging",
    AWS_REGION: "cn-north-1",
    AWS_SECRET_ACCESS_KEY: "secret",
    STORAGE_TOKEN: "storage-token",
    RECOVERY_TOKEN: "recovery-token",
  };
  return { patroni, walg, drill, options: { root, drillFile, patroniFile,
    walgFile, environment } };
}

function patroniConfigValue(executable, patroniConfigFile) {
  const controller = (args) => ({ ...executable, args, environmentKeys: ["HA_TOKEN"] });
  return {
    schemaVersion: 1, environment: "staging", clusterName: "ai-phone-staging",
    sourceDatabase: "ai_phone_staging", patronictl: executable, psql: executable,
    patroniEnvironmentKeys: ["PATRONI_SECRET"],
    databaseEnvironmentKeys: ["PGSERVICEFILE", "PGPASSFILE", "PGSSLROOTCERT"],
    patroniConfigFile, stateDirectory: "outputs/postgres-resilience/patroni-state",
    probeTable: "public.ai_phone_ha_probe",
    nodes: [{ id: "db-a", failureDomain: "zone-a", pgService: "db-a-direct" },
      { id: "db-b", failureDomain: "zone-b", pgService: "db-b-direct" }],
    dcsVoters: [{ id: "dcs-a", failureDomain: "zone-a" },
      { id: "dcs-b", failureDomain: "zone-b" },
      { id: "dcs-c", failureDomain: "zone-c" }],
    requiredEnvironmentKeys: ["PATRONI_SECRET", "PGSERVICEFILE", "PGPASSFILE",
      "PGSSLROOTCERT", "HA_TOKEN"],
    writerPgService: "ai-phone-writer", failoverCandidateId: "db-b",
    dcsController: controller(["verify-quorum", "--json"]),
    failureController: controller(["inject", "{oldPrimaryId}", "--json"]),
    recoveryController: controller(["recover", "{oldPrimaryId}", "--json"]),
    pollIntervalMs: 100, failoverTimeoutSeconds: 30, rebuildTimeoutSeconds: 60,
  };
}

function walgConfigValue(root, executable, pgDataDirectory) {
  return {
    schemaVersion: 1, environment: "staging", sourceDatabase: "ai_phone_staging",
    restoreDatabase: "ai_phone_restore_drill_01", walG: executable, psql: executable,
    pgDump: executable,
    walGEnvironmentKeys: ["WALG_S3_PREFIX", "AWS_REGION", "AWS_SECRET_ACCESS_KEY"],
    databaseEnvironmentKeys: ["PGSERVICEFILE", "PGPASSFILE", "PGSSLROOTCERT"],
    pgDataDirectory, restoreDataDirectory: path.join(root, "ai_phone_restore_drill_01"),
    stateDirectory: "outputs/postgres-resilience/walg-state",
    writerPgService: "ai-phone-writer", restorePgService: "ai-phone-restore",
    storageController: { ...executable, args: ["{action}", "--json"],
      environmentKeys: ["STORAGE_TOKEN"] },
    recoveryController: { ...executable, args: ["{action}", "--json"],
      environmentKeys: ["RECOVERY_TOKEN"] },
    requiredEnvironmentKeys: ["WALG_S3_PREFIX", "AWS_REGION", "AWS_SECRET_ACCESS_KEY",
      "PGSERVICEFILE", "PGPASSFILE", "PGSSLROOTCERT", "STORAGE_TOKEN", "RECOVERY_TOKEN"],
    retentionDays: 30, requireEncryptionInTransit: true,
    requireEncryptionAtRest: true, requireImmutability: true,
    backupTimeoutSeconds: 60, restoreTimeoutSeconds: 60, verifyTimeoutSeconds: 10,
  };
}

function drillConfig(patroni, walg) {
  const command = (script, step, environmentKeys) => ({ file: process.execPath,
    args: [script, step, "--json"], environmentKeys, timeoutSeconds: 60 });
  const pBase = ["PATRONI_HA_PROVIDER_CONFIG_FILE", ...patroni.patroniEnvironmentKeys];
  const pDb = patroni.databaseEnvironmentKeys;
  const wBase = ["WALG_BACKUP_PROVIDER_CONFIG_FILE", ...walg.walGEnvironmentKeys];
  const wDb = walg.databaseEnvironmentKeys;
  return {
    schemaVersion: 1, environment: "staging", topologyFile: "infra/topology.json",
    capacityResultFile: "outputs/capacity.json",
    safety: { acknowledgement: "WUJIE_POSTGRES_STAGING_ONLY",
      sourceDatabase: "ai_phone_staging", restoreDatabase: "ai_phone_restore_drill_01",
      tlsMode: "verify-full", allowAutomaticFailover: true,
      allowRestoreTargetCreation: true, gracefulDrainSeconds: 30 },
    objectives: { maxRpoSeconds: 300, maxRtoSeconds: 120 },
    ha: { mode: "patroni_etcd",
      nodes: patroni.nodes.map((value) => ({ hostId: value.id,
        failureDomain: value.failureDomain })), dcsVoters: 3,
      dcsFailureDomains: ["zone-a", "zone-b", "zone-c"], commands: {
        baseline: command("scripts/run_patroni_ha_provider.mjs", "baseline",
          [...pBase, ...pDb, "HA_TOKEN"]),
        triggerFailover: command("scripts/run_patroni_ha_provider.mjs", "trigger-failover",
          [...pBase, ...pDb, "HA_TOKEN"]),
        verifyFencing: command("scripts/run_patroni_ha_provider.mjs", "verify-fencing",
          [...pBase, ...pDb]),
        verifyEndpoint: command("scripts/run_patroni_ha_provider.mjs", "verify-endpoint",
          [...pBase, ...pDb]),
        rebuildOldPrimary: command("scripts/run_patroni_ha_provider.mjs",
          "rebuild-old-primary", [...pBase, "HA_TOKEN"]),
      } },
    wal: { mode: "wal_g_object_storage", targetClass: "off_host_object_storage",
      retentionDays: 30, requireEncryptionInTransit: true,
      requireEncryptionAtRest: true, requireImmutability: true, commands: {
        createBaseBackup: command("scripts/run_walg_backup_provider.mjs",
          "create-base-backup", [...wBase, "STORAGE_TOKEN"]),
        verifyArchive: command("scripts/run_walg_backup_provider.mjs", "verify-archive",
          [...wBase, ...wDb, "STORAGE_TOKEN"]),
        restoreOffHost: command("scripts/run_walg_backup_provider.mjs", "restore-off-host",
          [...wBase, "RECOVERY_TOKEN"]),
        verifyRestore: command("scripts/run_walg_backup_provider.mjs", "verify-restore",
          ["WALG_BACKUP_PROVIDER_CONFIG_FILE", ...wDb, "RECOVERY_TOKEN"]),
      } },
  };
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function pgServices(patroni, walg) {
  const source = new Set([patroni.writerPgService,
    ...patroni.nodes.map((node) => node.pgService), walg.writerPgService]);
  const sections = [...source].map((name) => [name, patroni.sourceDatabase]);
  sections.push([walg.restorePgService, walg.restoreDatabase]);
  return sections.map(([name, database], index) => [
    `[${name}]`,
    `host=db-${index + 1}.staging.internal`,
    `dbname=${database}`,
    "sslmode=verify-full",
  ].join("\n")).join("\n\n");
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
