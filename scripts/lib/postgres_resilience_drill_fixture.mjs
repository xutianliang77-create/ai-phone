export function validPostgresResilienceDrillConfig() {
  return {
    schemaVersion: 1,
    environment: "staging",
    topologyFile: "infra/platform-ha/topology.json",
    capacityResultFile: "outputs/platform-capacity/latest.json",
    safety: {
      acknowledgement: "WUJIE_POSTGRES_STAGING_ONLY",
      sourceDatabase: "ai_phone_staging",
      restoreDatabase: "ai_phone_restore_drill_01",
      tlsMode: "verify-full",
      allowAutomaticFailover: true,
      allowRestoreTargetCreation: true,
      gracefulDrainSeconds: 30,
    },
    objectives: { maxRpoSeconds: 300, maxRtoSeconds: 120 },
    ha: {
      mode: "managed_ha",
      nodes: [
        { hostId: "db-a", failureDomain: "zone-a" },
        { hostId: "db-b", failureDomain: "zone-b" },
      ],
      commands: {
        baseline: command(),
        triggerFailover: command(),
        verifyFencing: command(),
        verifyEndpoint: command(),
        rebuildOldPrimary: command(),
      },
    },
    wal: {
      mode: "provider_managed_object_storage",
      targetClass: "off_host_object_storage",
      retentionDays: 30,
      requireEncryptionInTransit: true,
      requireEncryptionAtRest: true,
      requireImmutability: true,
      commands: {
        createBaseBackup: command(),
        verifyArchive: command(),
        restoreOffHost: command(),
        verifyRestore: command(),
      },
    },
  };
}

function command() {
  return {
    file: "provider-cli",
    args: ["--json"],
    environmentKeys: ["PATH"],
    timeoutSeconds: 60,
  };
}
