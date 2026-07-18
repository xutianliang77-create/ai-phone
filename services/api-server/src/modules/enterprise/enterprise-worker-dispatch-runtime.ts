import type {
  EnterpriseTenantContext,
} from "./enterprise-tenant-context.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import {
  assertEnterpriseWorkerTicketSecret,
  issueEnterpriseWorkerDispatchTicket,
  verifyEnterpriseWorkerDispatchTicket,
  type EnterpriseWorkerDispatchTicketPayload,
} from "./enterprise-worker-dispatch-ticket.js";
import type {
  EnterpriseTenantPostgresPool,
} from "../../infrastructure/postgres/enterprise-postgres-tenant-session.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "../../infrastructure/postgres/enterprise-postgres-unit-of-work.js";
import type {
  IssueEnterpriseWorkerDispatchInput,
} from "../../infrastructure/postgres/enterprise-postgres-worker-dispatch-issue.js";

export function createEnterpriseWorkerDispatchRuntime(input: {
  pool: EnterpriseTenantPostgresPool;
  signingSecret: string;
}) {
  const signingSecret = assertEnterpriseWorkerTicketSecret(input.signingSecret);
  return {
    async issue(
      context: EnterpriseTenantContext,
      request: IssueEnterpriseWorkerDispatchInput,
    ) {
      const result = await withEnterprisePostgresUnitOfWork(
        input.pool,
        context,
        (unit) => unit.workerDispatches.issue(request),
      );
      if (result.status !== "created" && result.status !== "replayed") {
        return result;
      }
      const payload = payloadFor(result.grant);
      return {
        ...result,
        ticket: issueEnterpriseWorkerDispatchTicket({ payload, signingSecret }),
        payload,
      };
    },
    accept(request: WorkerTicketRequest & { leaseSeconds: number }) {
      return runTicketOperation(input.pool, signingSecret, request, (unit, payload) =>
        unit.workerDispatches.accept({
          payload,
          workerCellId: request.workerCellId,
          workerId: request.workerId,
          leaseSeconds: request.leaseSeconds,
          now: request.now,
        }));
    },
    heartbeat(request: WorkerTicketRequest & { leaseSeconds: number }) {
      return runTicketOperation(input.pool, signingSecret, request, (unit, payload) =>
        unit.workerDispatches.heartbeat({
          payload,
          workerCellId: request.workerCellId,
          workerId: request.workerId,
          leaseSeconds: request.leaseSeconds,
          now: request.now,
        }));
    },
    authorizeEffect(request: WorkerTicketRequest) {
      return runTicketOperation(input.pool, signingSecret, request, (unit, payload) =>
        unit.workerDispatches.authorize({
          payload,
          workerCellId: request.workerCellId,
          workerId: request.workerId,
          now: request.now,
        }));
    },
    finalize(request: WorkerTicketRequest & { outcome: "completed" | "failed" }) {
      return runTicketOperation(input.pool, signingSecret, request, (unit, payload) =>
        unit.workerDispatches.finalize({
          payload,
          workerCellId: request.workerCellId,
          workerId: request.workerId,
          outcome: request.outcome,
          now: request.now,
        }));
    },
    cancel(
      context: EnterpriseTenantContext,
      request: Parameters<
        import("../../infrastructure/postgres/enterprise-postgres-worker-dispatch-lifecycle.js")
          .EnterpriseWorkerDispatchLifecyclePostgresRepository["cancel"]
      >[0],
    ) {
      return withEnterprisePostgresUnitOfWork(
        input.pool,
        context,
        (unit) => unit.workerDispatches.cancel(request),
      );
    },
  };
}

interface WorkerTicketRequest {
  ticket: string;
  workerCellId: string;
  workerId: string;
  traceId: string;
  now?: Date;
}

function runTicketOperation<T>(
  pool: EnterpriseTenantPostgresPool,
  signingSecret: string,
  request: WorkerTicketRequest,
  operation: (
    unit: AwaitedUnit,
    payload: EnterpriseWorkerDispatchTicketPayload,
  ) => Promise<T>,
) {
  const payload = verifyEnterpriseWorkerDispatchTicket({
    ticket: request.ticket,
    signingSecret,
    now: request.now,
  });
  if (!payload) return Promise.resolve({ status: "invalid_ticket" as const });
  const context = createEnterpriseTenantContext({
    tenantId: payload.tenantId,
    actorUserId: "system:enterprise-worker-dispatch",
    traceId: request.traceId,
  });
  return withEnterprisePostgresUnitOfWork(
    pool,
    context,
    (unit) => operation(unit, payload),
  );
}

type AwaitedUnit = Parameters<
  Parameters<typeof withEnterprisePostgresUnitOfWork>[2]
>[0];

function payloadFor(
  grant: import("../../infrastructure/postgres/enterprise-postgres-worker-dispatch-record.js")
    .EnterpriseWorkerDispatchGrantRecord,
): EnterpriseWorkerDispatchTicketPayload {
  return {
    v: 3,
    ticketId: grant.id,
    tenantId: grant.tenantId,
    communicationSessionId: grant.communicationSessionId,
    policySnapshotId: grant.policySnapshotId,
    policyVersion: grant.policyVersion,
    entitlementVersion: grant.entitlementVersion,
    cellId: grant.cellId,
    routeEpoch: grant.routeEpoch,
    generation: grant.generation,
    capability: grant.capability,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
  };
}
