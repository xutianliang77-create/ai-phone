import { describe, expect, it } from "vitest";
import { validateWalgBackupProviderConfig } from "./walg_backup_provider_config.mjs";

function validConfig() {
  const executable = { file: "/opt/ai-phone/bin/provider", sha256: "a".repeat(64) };
  const controller = { ...executable, args: ["{action}"], environmentKeys: ["PATH"] };
  return {
    schemaVersion: 1,
    environment: "staging",
    sourceDatabase: "ai_phone_staging",
    restoreDatabase: "ai_phone_restore_drill_01",
    walG: executable,
    psql: executable,
    pgDump: executable,
    walGEnvironmentKeys: ["WALG_S3_PREFIX", "AWS_REGION", "AWS_ACCESS_KEY_ID"],
    databaseEnvironmentKeys: ["PGSERVICEFILE", "PGPASSFILE", "PGSSLROOTCERT"],
    pgDataDirectory: "/var/lib/postgresql/ai_phone_staging",
    restoreDataDirectory: "/var/lib/postgresql/ai_phone_restore_drill_01",
    stateDirectory: "outputs/postgres-resilience/walg-state",
    writerPgService: "ai-phone-writer",
    restorePgService: "ai-phone-restore",
    storageController: controller,
    recoveryController: controller,
    requiredEnvironmentKeys: ["WALG_S3_PREFIX", "AWS_REGION", "PGPASSFILE"],
    retentionDays: 30,
    requireEncryptionInTransit: true,
    requireEncryptionAtRest: true,
    requireImmutability: true,
    backupTimeoutSeconds: 3600,
    restoreTimeoutSeconds: 7200,
    verifyTimeoutSeconds: 600,
  };
}

describe("validateWalgBackupProviderConfig", () => {
  it("accepts one explicit object-storage backend and isolated restore target", () => {
    expect(validateWalgBackupProviderConfig(validConfig())).toEqual([]);
  });

  it("rejects ambiguous storage prefixes and inherited database environment", () => {
    const config = validConfig();
    config.walGEnvironmentKeys.push("WALG_GS_PREFIX");
    config.databaseEnvironmentKeys = undefined;
    config.requiredEnvironmentKeys.push("NOT_ALLOWLISTED");
    expect(validateWalgBackupProviderConfig(config)).toEqual(expect.arrayContaining([
      "walGEnvironmentKeys must select exactly one object-storage prefix",
      "databaseEnvironmentKeys is invalid",
      "requiredEnvironmentKeys must be allowlisted by a provider component",
    ]));
  });
});
