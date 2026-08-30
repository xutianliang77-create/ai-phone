import { describe, expect, it } from "vitest";
import type { EnterpriseControlPlanePool } from
  "./enterprise-control-plane-types.js";
import type { EnterpriseControlPlaneConfig } from
  "./enterprise-control-plane-types.js";
import {
  claimEnterpriseControlPlaneProvisionBatch,
  enterpriseControlPlaneStatus,
  heartbeatEnterpriseControlPlaneInstance,
  registerEnterpriseControlPlaneInstance,
  releaseEnterpriseControlPlaneProvisionClaim,
  renewEnterpriseControlPlaneProvisionClaim,
} from "./enterprise-control-plane.repository.js";

const config: EnterpriseControlPlaneConfig = {
  workerId: "control-01",
  region: "cn-north",
  buildCommit: "a".repeat(40),
  imageDigest: `sha256:${"b".repeat(64)}`,
  pollIntervalMs: 5_000,
  batchSize: 25,
  leaseMs: 30_000,
  expectedReplicas: 2,
  maxProvisionBacklogSeconds: 300,
};

describe("enterprise control-plane repository", () => {
  it("registers, claims, renews and releases with stable generations", async () => {
    const pool = fakePool();
    const lease = await registerEnterpriseControlPlaneInstance({
      pool, config, traceId: "register",
    });
    expect(lease.generation).toBe("1");
    expect(await heartbeatEnterpriseControlPlaneInstance({
      pool, lease, traceId: "heartbeat", leaseMs: config.leaseMs,
    })).toBe(true);
    const claims = await claimEnterpriseControlPlaneProvisionBatch({
      pool, lease, traceId: "claim", leaseMs: config.leaseMs, limit: 10,
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      tenantId: tenantId,
      jobId,
      actorUserId: "user_owner",
      homeRegion: "cn-north",
      coordination: { workerId: "control-01", generation: "7" },
    });
    expect(await renewEnterpriseControlPlaneProvisionClaim({
      pool, claim: claims[0]!, traceId: "renew", leaseMs: config.leaseMs,
    })).toBe(true);
    expect(await releaseEnterpriseControlPlaneProvisionClaim({
      pool, claim: claims[0]!, traceId: "release",
    })).toBe(true);
  });

  it("reports live replica and backlog status without tenant contents", async () => {
    const result = await enterpriseControlPlaneStatus({
      pool: fakePool(), config, traceId: "status",
    });
    expect(result).toMatchObject({
      status: "ready",
      activeInstances: 2,
      expectedReplicas: 2,
      dueProvisionJobs: 0,
    });
  });
});

const tenantId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const future = new Date(Date.now() + 60_000).toISOString();

function fakePool(): EnterpriseControlPlanePool {
  return {
    async connect() {
      return {
        async query<Row extends Record<string, unknown>>(sql: string) {
          let rows: Record<string, unknown>[] = [];
          if (sql.includes("INSERT INTO enterprise.control_plane_instances")) {
            rows = [{ instance_id: "control-01", region: "cn-north",
              generation: "1", lease_expires_at: future }];
          } else if (sql.includes("UPDATE enterprise.control_plane_instances")) {
            rows = [{ generation: "1", lease_expires_at: future }];
          } else if (sql.includes("WITH candidates AS")) {
            rows = [{ tenant_id: tenantId, job_id: jobId, actor_id: "user_owner",
              home_region: "cn-north", due_at: new Date().toISOString(),
              coordination_owner: "control-01", coordination_generation: "7",
              coordination_lease_expires_at: future }];
          } else if (sql.includes("UPDATE enterprise.control_plane_pending_work")) {
            rows = [{ coordination_generation: "7",
              coordination_lease_expires_at: sql.includes("= NULL") ? null : future }];
          } else if (sql.includes("active_count")) {
            rows = [{ active_count: "2", draining_count: "0",
              incompatible_count: "0" }];
          } else if (sql.includes("due_count")) {
            rows = [{ due_count: "0", oldest_due_at: null,
              oldest_age_seconds: "0" }];
          }
          return { rows: rows as Row[] };
        },
        release() {},
      };
    },
  };
}
