import type { TenantProvisioner } from
  "../../modules/enterprise/enterprise-tenant-provisioner.js";
import type { EnterpriseControlPlanePool } from
  "./enterprise-control-plane-types.js";
import type { EnterpriseControlPlaneConfig } from
  "./enterprise-control-plane-types.js";
import {
  claimEnterpriseControlPlaneProvisionBatch,
  heartbeatEnterpriseControlPlaneInstance,
  registerEnterpriseControlPlaneInstance,
  type EnterpriseControlPlaneInstanceLease,
  type EnterpriseControlPlaneProvisionClaim,
} from "./enterprise-control-plane.repository.js";
import { withEnterpriseControlPlaneProvisionClaim } from
  "./enterprise-control-plane-claim.js";

interface EnterpriseControlPlaneRuntime {
  findTenantJob(input: {
    jobId: string;
    userId: string;
    traceId: string;
  }): Promise<{
    id: string;
    tenantId: string;
    actorUserId: string;
    type: string;
    status: string;
  } | null>;
  finalizeTenantProvision(input: {
    tenantId: string;
    actorUserId: string;
    jobId: string;
    result: Awaited<ReturnType<TenantProvisioner["provision"]>>;
  }): Promise<{ job?: { status: string } }>;
}

export async function runEnterpriseControlPlaneWorker(options: {
  pool: EnterpriseControlPlanePool;
  runtime: EnterpriseControlPlaneRuntime;
  provisioner: TenantProvisioner;
  config: EnterpriseControlPlaneConfig;
  signal: AbortSignal;
  onBatch?: (result: EnterpriseControlPlaneBatchResult) => void;
  onError?: (error: unknown) => void;
}) {
  const lease = await registerEnterpriseControlPlaneInstance({
    pool: options.pool,
    config: options.config,
    traceId: workerTrace(options.config.workerId, "register"),
  });
  let fatalError: Error | undefined;
  try {
    while (!options.signal.aborted) {
      const owned = await heartbeatEnterpriseControlPlaneInstance({
        pool: options.pool,
        lease,
        traceId: workerTrace(options.config.workerId, "heartbeat"),
        leaseMs: options.config.leaseMs,
      }).catch(() => false);
      if (!owned) {
        fatalError = new Error("Enterprise control-plane instance lease lost");
        options.onError?.(fatalError);
        break;
      }
      try {
        const result = await runEnterpriseControlPlaneBatch(options, lease);
        options.onBatch?.(result);
      } catch (error) {
        options.onError?.(error);
      }
      await wait(options.config.pollIntervalMs, options.signal);
    }
  } finally {
    await heartbeatEnterpriseControlPlaneInstance({
      pool: options.pool,
      lease,
      traceId: workerTrace(options.config.workerId, "drain"),
      leaseMs: options.config.leaseMs,
      draining: true,
    }).catch(() => false);
  }
  if (fatalError) throw fatalError;
}

export interface EnterpriseControlPlaneBatchResult {
  inspected: number;
  completed: number;
  failed: number;
  stale: number;
}

export async function runEnterpriseControlPlaneBatch(
  options: {
    pool: EnterpriseControlPlanePool;
    runtime: EnterpriseControlPlaneRuntime;
    provisioner: TenantProvisioner;
    config: EnterpriseControlPlaneConfig;
  },
  lease: EnterpriseControlPlaneInstanceLease,
) {
  const claims = await claimEnterpriseControlPlaneProvisionBatch({
    pool: options.pool,
    lease,
    traceId: workerTrace(options.config.workerId, "claim"),
    leaseMs: options.config.leaseMs,
    limit: options.config.batchSize,
  });
  const counts: EnterpriseControlPlaneBatchResult = {
    inspected: claims.length,
    completed: 0,
    failed: 0,
    stale: 0,
  };
  const results = await Promise.all(claims.map((claim) =>
    processClaim(options, claim).catch(() => "failed" as const)
  ));
  for (const result of results) counts[result] += 1;
  return counts;
}

async function processClaim(
  options: Parameters<typeof runEnterpriseControlPlaneBatch>[0],
  claim: EnterpriseControlPlaneProvisionClaim,
) {
  const traceId = workerTrace(options.config.workerId, claim.jobId);
  return withEnterpriseControlPlaneProvisionClaim({
    pool: options.pool,
    claim,
    leaseMs: options.config.leaseMs,
    traceId,
    operation: async ({ assertOwned }) => {
      const job = await options.runtime.findTenantJob({
        jobId: claim.jobId,
        userId: claim.actorUserId,
        traceId,
      });
      if (!job || job.tenantId !== claim.tenantId ||
        job.actorUserId !== claim.actorUserId ||
        job.type !== "tenant.provision" || job.status !== "processing") {
        return "stale" as const;
      }
      await assertOwned();
      let result: Awaited<ReturnType<TenantProvisioner["provision"]>>;
      try {
        result = await options.provisioner.provision({
          tenantId: claim.tenantId,
          homeRegion: claim.homeRegion,
        });
      } catch {
        throw new Error("Enterprise tenant provisioner unavailable");
      }
      await assertOwned();
      const finalized = await options.runtime.finalizeTenantProvision({
        tenantId: claim.tenantId,
        actorUserId: claim.actorUserId,
        jobId: claim.jobId,
        result,
      });
      return finalized.job?.status === "completed"
        ? "completed" as const
        : finalized.job?.status === "failed"
        ? "failed" as const
        : "stale" as const;
    },
  });
}

function workerTrace(workerId: string, operation: string) {
  return `enterprise-control:${workerId}:${operation}:${Date.now()}`;
}

function wait(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
