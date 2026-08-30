import type { EnterpriseControlPlanePool } from
  "./enterprise-control-plane-types.js";
import {
  releaseEnterpriseControlPlaneProvisionClaim,
  renewEnterpriseControlPlaneProvisionClaim,
  type EnterpriseControlPlaneProvisionClaim,
} from "./enterprise-control-plane.repository.js";

export async function withEnterpriseControlPlaneProvisionClaim<T>(input: {
  pool: EnterpriseControlPlanePool;
  claim: EnterpriseControlPlaneProvisionClaim;
  leaseMs: number;
  traceId: string;
  operation: (lease: { assertOwned(): Promise<void> }) => Promise<T>;
}) {
  let stopped = false;
  let lost = false;
  let timer: NodeJS.Timeout | undefined;
  let renewal = Promise.resolve(true);
  const renew = () => {
    renewal = renewal.then(async () => {
      if (stopped || lost) return !lost;
      const owned = await renewEnterpriseControlPlaneProvisionClaim({
        pool: input.pool,
        claim: input.claim,
        traceId: `${input.traceId}:heartbeat`,
        leaseMs: input.leaseMs,
      }).catch(() => false);
      if (!owned) lost = true;
      return owned;
    });
    return renewal;
  };
  const schedule = () => {
    if (stopped || lost) return;
    timer = setTimeout(() => {
      void renew().then(schedule);
    }, Math.max(500, Math.floor(input.leaseMs / 3)));
    timer.unref();
  };
  try {
    const assertOwned = async () => {
      await renew();
      if (lost) throw new Error("Enterprise control-plane provision claim lost");
    };
    await assertOwned();
    schedule();
    return await input.operation({ assertOwned });
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    await renewal;
    await releaseEnterpriseControlPlaneProvisionClaim({
      pool: input.pool,
      claim: input.claim,
      traceId: `${input.traceId}:release`,
    }).catch(() => false);
  }
}
