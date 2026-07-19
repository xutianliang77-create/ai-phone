import { describe, expect, it } from "vitest";
import { validatePatroniHaProviderConfig } from "./patroni_ha_provider_config.mjs";

function validConfig() {
  const executable = { file: "/opt/ai-phone/bin/provider", sha256: "a".repeat(64) };
  const controller = { ...executable, args: ["{runId}"], environmentKeys: ["PATH"] };
  return {
    schemaVersion: 1,
    environment: "staging",
    clusterName: "ai-phone-staging",
    sourceDatabase: "ai_phone_staging",
    patronictl: executable,
    psql: executable,
    patroniEnvironmentKeys: ["PATH", "PATRONI_ETCD3_PASSWORD"],
    databaseEnvironmentKeys: ["PATH", "PGSERVICEFILE", "PGPASSFILE"],
    patroniConfigFile: "/etc/patroni/staging.yml",
    stateDirectory: "outputs/postgres-resilience/patroni-state",
    probeTable: "public.ha_probe",
    nodes: [
      { id: "db-a", failureDomain: "zone-a", pgService: "db-a-direct" },
      { id: "db-b", failureDomain: "zone-b", pgService: "db-b-direct" },
    ],
    writerPgService: "ai-phone-writer",
    failoverCandidateId: "db-b",
    failureController: controller,
    recoveryController: controller,
    dcsController: controller,
    dcsVoters: [
      { id: "dcs-a", failureDomain: "zone-a" },
      { id: "dcs-b", failureDomain: "zone-b" },
      { id: "dcs-c", failureDomain: "zone-c" },
    ],
    requiredEnvironmentKeys: ["PGSERVICEFILE", "PGPASSFILE",
      "PATRONI_ETCD3_PASSWORD"],
    pollIntervalMs: 100,
    failoverTimeoutSeconds: 30,
    rebuildTimeoutSeconds: 60,
  };
}

describe("validatePatroniHaProviderConfig", () => {
  it("accepts a staging Patroni provider with explicit environment allowlists", () => {
    expect(validatePatroniHaProviderConfig(validConfig())).toEqual([]);
  });

  it("rejects inherited environment and same-domain nodes", () => {
    const config = validConfig();
    config.databaseEnvironmentKeys = undefined;
    config.nodes[1].failureDomain = "zone-a";
    config.requiredEnvironmentKeys.push("NOT_ALLOWLISTED");
    expect(validatePatroniHaProviderConfig(config)).toEqual(expect.arrayContaining([
      "databaseEnvironmentKeys is invalid",
      "nodes must identify two distinct hosts and failure domains",
      "requiredEnvironmentKeys must be allowlisted by a provider component",
    ]));
  });
});
