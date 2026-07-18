import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPlatformTopology } from "./platform_topology_config.mjs";

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("platform topology PostgreSQL HA modes", () => {
  it.each(["managed_ha", "patroni_etcd"])("accepts %s", (postgresMode) => {
    const file = topologyFile(postgresMode);
    expect(checkPlatformTopology({ file, release: true }).status).toBe("ready");
  });

  it("rejects a standalone PostgreSQL writer", () => {
    const checked = checkPlatformTopology({ file: topologyFile("standalone"), release: true });
    expect(checked.status).toBe("not_ready");
    expect(checked.issues).toContain(
      "PostgreSQL managed HA or Patroni/etcd is required",
    );
  });
});

function topologyFile(postgresMode) {
  const directory = mkdtempSync(path.join(tmpdir(), "platform-topology-"));
  directories.push(directory);
  const file = path.join(directory, "topology.json");
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    status: "verified",
    targetConcurrentSessions: 100,
    steadyStateUtilization: 0.7,
    admissionRejectUtilization: 0.85,
    regions: [
      {
        id: "cn-north-1",
        dataRegion: "cn",
        active: true,
        acceptNewSessions: true,
        livekitEndpoint: "wss://livekit-north.qkxy.cn",
        apiEndpoint: "https://api-north.qkxy.cn",
      },
      {
        id: "cn-east-1",
        dataRegion: "cn",
        active: true,
        acceptNewSessions: false,
        livekitEndpoint: "wss://livekit-east.qkxy.cn",
        apiEndpoint: "https://api-east.qkxy.cn",
      },
    ],
    pools: Object.fromEntries([
      "api", "livekit", "sip", "translation", "agent", "egress", "ingress",
    ].map((name) => [name, { minReplicas: 2, maxReplicas: 4 }])),
    state: {
      postgresMode,
      redisMode: "managed_ha",
      objectStorageReplication: "same_data_region",
      singleWriterPerAggregate: true,
    },
    routing: {
      sessionPlacement: "home_region_sticky",
      crossRegionFailover: "new_sessions_only",
      maxFailoverRtoSeconds: 120,
      turnRouting: "region_local",
    },
    acceptance: {
      steps: [25, 50, 100],
      soakMinutes: 120,
      providerSideEffectDuplicatesAllowed: 0,
      lostFinalEventsAllowed: 0,
    },
  }));
  return file;
}
