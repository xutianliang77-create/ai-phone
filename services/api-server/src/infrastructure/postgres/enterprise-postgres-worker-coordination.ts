import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  releaseEnterprisePostgresPendingWorkClaim,
  renewEnterprisePostgresPendingWorkClaim,
  type EnterprisePostgresPendingWorkClaim,
} from "./enterprise-postgres-worker-coordination.repository.js";

export async function withEnterprisePostgresWorkClaim<T>(input: {
  pool: EnterpriseTenantPostgresPool;
  claim: EnterprisePostgresPendingWorkClaim;
  leaseMs: number;
  traceId: string;
  operation: (lease: { assertOwned(): Promise<void> }) => Promise<T>;
}) {
  assertLeaseMs(input.leaseMs);
  let stopped = false;
  let lost = false;
  let timer: NodeJS.Timeout | undefined;
  let renewal = Promise.resolve();
  const renew = async () => {
    const owned = await renewEnterprisePostgresPendingWorkClaim({
      pool: input.pool,
      claim: input.claim,
      traceId: `${input.traceId}:heartbeat`,
      leaseMs: input.leaseMs,
    }).catch(() => false);
    if (!owned) lost = true;
  };
  const schedule = () => {
    if (stopped || lost) return;
    timer = setTimeout(() => {
      renewal = renew().then(schedule);
    }, Math.max(250, Math.floor(input.leaseMs / 3)));
    timer.unref();
  };
  try {
    const assertOwned = async () => {
      await renew();
      if (lost) {
        throw new Error("Enterprise pending work coordination claim lost");
      }
    };
    await assertOwned();
    schedule();
    return await input.operation({ assertOwned });
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    await renewal;
    await releaseEnterprisePostgresPendingWorkClaim({
      pool: input.pool,
      claim: input.claim,
      traceId: `${input.traceId}:release`,
    }).catch(() => false);
  }
}

function assertLeaseMs(value: number) {
  if (!Number.isInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error("Invalid enterprise pending work coordination lease duration");
  }
}
