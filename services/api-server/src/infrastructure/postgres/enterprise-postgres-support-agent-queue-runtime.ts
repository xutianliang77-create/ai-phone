import { randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseSupportAgentRequestHash } from
  "../../modules/enterprise/enterprise-support-agent.js";
import type { EnterpriseSupportRepositoryRuntime } from
  "../../modules/enterprise/enterprise-support-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import { stopEnterpriseSupportAgent } from
  "./enterprise-postgres-support-workbench-runtime.js";

type Runtime = Pick<EnterpriseSupportRepositoryRuntime,
  "createSupportQueue" | "listSupportQueues" | "listSupportQueueWorkItems" |
  "claimSupportSession" | "renewSupportAgentClaim" |
  "releaseSupportAgentClaim" | "reassignSupportAgentClaim">;

export function createEnterprisePostgresSupportAgentQueueRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    createSupportQueue(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.support.createQueue(input.queue);
        if (result.status === "created") await audit(unit, input.context, {
          action: "support.queue.create", resourceType: "support_queue",
          resourceId: result.queue.id, createdAt: result.queue.createdAt,
          details: { status: result.queue.status,
            defaultPriority: result.queue.defaultPriority,
            handoffSlaSeconds: result.queue.handoffSlaSeconds,
            claimLeaseSeconds: result.queue.claimLeaseSeconds },
        });
        return result;
      });
    },
    listSupportQueues(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => ({
        status: "ready", queues: await unit.support.listQueues(),
      }));
    },
    listSupportQueueWorkItems(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const queue = await unit.support.findQueue(input.queueId);
        if (!queue) return { status: "queue_not_found" };
        if (queue.status !== "active") return { status: "queue_unavailable" };
        return { status: "ready", workItems: await unit.supportAgentQueue
          .listWorkItems(queue.id, input.now, input.limit) };
      });
    },
    claimSupportSession(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const requestHash = enterpriseSupportAgentRequestHash({
          action: "claim", sessionId: input.sessionId,
          expectedSessionVersion: input.expectedSessionVersion,
          agentUserId: input.context.actorUserId,
        });
        const prior = await unit.supportAgentQueue
          .findByCreationKey(input.idempotencyKey);
        if (prior) {
          if (prior.requestHash !== requestHash ||
            prior.supportSessionId !== input.sessionId ||
            prior.agentUserId !== input.context.actorUserId) {
            return { status: "idempotency_conflict" };
          }
          await unit.supportAgents.findLatestRunForSession(input.sessionId, true);
          const replaySession = await unit.support.findSession(input.sessionId, true);
          if (!replaySession) return { status: "not_found" };
          const stopped = replaySession.status === "human_active" &&
            replaySession.activeAgentClaimId === prior.id && prior.status === "active" &&
            prior.leaseExpiresAt > input.now
            ? await stopEnterpriseSupportAgent(unit, input.sessionId, input.now)
            : null;
          return { status: "replayed", claim: prior, session: replaySession,
            ...(stopped ? { aiSpeechFence: stopped.fence } : {}) };
        }
        await unit.supportAgents.findLatestRunForSession(input.sessionId, true);
        let session = await unit.support.findSession(input.sessionId, true);
        if (!session) return { status: "not_found" };
        if (session.version !== input.expectedSessionVersion) {
          return { status: "conflict" };
        }
        const queue = session.queueId
          ? await unit.support.findQueue(session.queueId) : null;
        if (!queue) return { status: "queue_not_found" };
        if (queue.status !== "active") return { status: "queue_unavailable" };
        const activeClaim = await unit.supportAgentQueue
          .findActiveForSession(session.id, true);
        if (session.status === "human_active") {
          if (!activeClaim || activeClaim.id !== session.activeAgentClaimId) {
            throw new Error("Support session active claim invariant failed");
          }
          if (activeClaim.leaseExpiresAt > input.now) {
            return { status: "already_claimed" };
          }
          const expired = await unit.supportAgentQueue.terminateClaim({
            claimId: activeClaim.id, expectedVersion: activeClaim.version,
            status: "expired", releasedAt: input.now,
            releasedBy: input.context.actorUserId, releaseReason: "lease_expired",
            idempotencyKey: derivedKey("expire", requestHash),
            requestHash: enterpriseSupportAgentRequestHash({ action: "expire",
              claimId: activeClaim.id, claimRequestHash: requestHash }),
          });
          if (expired.status !== "updated") {
            throw new Error("Support expired claim transition failed");
          }
          const handoff = await unit.support.transition({ sessionId: session.id,
            status: "handoff_requested", expectedVersion: session.version,
            occurredAt: input.now });
          if (handoff.status !== "updated") {
            throw new Error("Support expired session release failed");
          }
          session = handoff.session;
        } else if (activeClaim) {
          return { status: "already_claimed" };
        }
        if (session.status !== "handoff_requested") {
          return { status: "not_handoff_requested" };
        }
        const created = await unit.supportAgentQueue.createClaim({
          id: randomUUID(), supportSessionId: session.id, queueId: queue.id,
          agentUserId: input.context.actorUserId,
          idempotencyKey: input.idempotencyKey, requestHash,
          claimedAt: input.now,
          leaseExpiresAt: plusSeconds(input.now, queue.claimLeaseSeconds),
        });
        if (created.status === "conflict") return { status: "conflict" };
        const activated = await unit.support.transition({ sessionId: session.id,
          status: "human_active", expectedVersion: session.version,
          occurredAt: input.now, assignedUserId: input.context.actorUserId,
          activeAgentClaimId: created.claim.id });
        if (activated.status !== "updated") {
          throw new Error("Support claim session activation failed");
        }
        const stopped = await stopEnterpriseSupportAgent(unit, session.id, input.now);
        await audit(unit, input.context, { action: "support.claim.create",
          resourceType: "support_agent_claim", resourceId: created.claim.id,
          createdAt: input.now, details: { sessionId: session.id,
            queueId: queue.id, agentUserId: created.claim.agentUserId,
            leaseExpiresAt: created.claim.leaseExpiresAt,
            aiSpeechFence: stopped.fence.status,
            ...(stopped.fence.runId ? { runId: stopped.fence.runId } : {}) } });
        return { status: created.status === "replayed" ? "replayed" : "claimed",
          claim: created.claim, session: activated.session,
          aiSpeechFence: stopped.fence };
      });
    },
    renewSupportAgentClaim(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const claim = await unit.supportAgentQueue.findClaim(input.claimId, true);
        if (!claim) return { status: "not_found" };
        if (!canControl(input.context.actorRole, input.context.actorUserId,
          claim.agentUserId)) return { status: "forbidden" };
        if (claim.status !== "active") return { status: "claim_not_active" };
        if (claim.leaseExpiresAt <= input.now) return { status: "claim_expired" };
        const queue = await unit.support.findQueue(claim.queueId);
        if (!queue) return { status: "queue_not_found" };
        const result = await unit.supportAgentQueue.renewClaim({ claimId: claim.id,
          expectedVersion: input.expectedClaimVersion, updatedAt: input.now,
          leaseExpiresAt: plusSeconds(input.now, queue.claimLeaseSeconds) });
        if (result.status !== "updated") return { status: "conflict" };
        await audit(unit, input.context, { action: "support.claim.renew",
          resourceType: "support_agent_claim", resourceId: claim.id,
          createdAt: input.now,
          details: { leaseExpiresAt: result.claim.leaseExpiresAt,
            version: result.claim.version } });
        return { status: "renewed", claim: result.claim };
      });
    },
    releaseSupportAgentClaim(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const discovered = await unit.supportAgentQueue.findClaim(input.claimId);
        if (!discovered) return { status: "not_found" };
        if (!canControl(input.context.actorRole, input.context.actorUserId,
          discovered.agentUserId)) return { status: "forbidden" };
        const session = await unit.support.findSession(
          discovered.supportSessionId, true,
        );
        const claim = await unit.supportAgentQueue.findClaim(input.claimId, true);
        if (!session || !claim || claim.supportSessionId !== session.id) {
          return { status: "not_found" };
        }
        const reason = claim.agentUserId === input.context.actorUserId
          ? input.reason : "manager_release";
        const requestHash = enterpriseSupportAgentRequestHash({ action: "release",
          claimId: input.claimId, expectedClaimVersion: input.expectedClaimVersion,
          expectedSessionVersion: input.expectedSessionVersion, reason,
          releasedBy: input.context.actorUserId });
        if (claim.status === "active") {
          if (session.activeAgentClaimId !== claim.id) {
            throw new Error("Support release session binding failed");
          }
          if (session.version !== input.expectedSessionVersion) {
            return { status: "conflict" };
          }
        }
        const terminated = await unit.supportAgentQueue.terminateClaim({
          claimId: claim.id, expectedVersion: input.expectedClaimVersion,
          status: "released", releasedAt: input.now,
          releasedBy: input.context.actorUserId, releaseReason: reason,
          idempotencyKey: input.idempotencyKey, requestHash,
        });
        if (terminated.status === "replayed") {
          return { status: "replayed", claim: terminated.claim,
            session };
        }
        if (terminated.status === "already_terminal") {
          return { status: "idempotency_conflict" };
        }
        if (terminated.status !== "updated") return { status: "conflict" };
        const handoff = await unit.support.transition({ sessionId: session.id,
          status: "handoff_requested", expectedVersion: session.version,
          occurredAt: input.now });
        if (handoff.status !== "updated") {
          throw new Error("Support release session transition failed");
        }
        await audit(unit, input.context, { action: "support.claim.release",
          resourceType: "support_agent_claim", resourceId: claim.id,
          createdAt: input.now, details: { sessionId: session.id, reason,
            releasedBy: input.context.actorUserId } });
        return { status: "released", claim: terminated.claim,
          session: handoff.session };
      });
    },
    reassignSupportAgentClaim(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!isManager(input.context.actorRole)) return { status: "forbidden" };
        const requestHash = enterpriseSupportAgentRequestHash({ action: "reassign",
          claimId: input.claimId, targetUserId: input.targetUserId,
          expectedClaimVersion: input.expectedClaimVersion,
          expectedSessionVersion: input.expectedSessionVersion,
          reassignedBy: input.context.actorUserId });
        const prior = await unit.supportAgentQueue
          .findByCreationKey(input.idempotencyKey);
        if (prior) {
          if (prior.requestHash !== requestHash ||
            prior.reassignedFromClaimId !== input.claimId ||
            prior.agentUserId !== input.targetUserId) {
            return { status: "idempotency_conflict" };
          }
          const previous = await unit.supportAgentQueue.findClaim(input.claimId);
          const session = await unit.support.findSession(prior.supportSessionId);
          if (!previous || !session) return { status: "not_found" };
          return { status: "replayed", previousClaim: previous,
            claim: prior, session };
        }
        const discovered = await unit.supportAgentQueue.findClaim(input.claimId);
        if (!discovered) return { status: "not_found" };
        const target = await unit.tenant.findMemberByUserId(input.targetUserId);
        if (!target || target.status !== "active" || !isSupportRole(target.role) ||
          target.userId === discovered.agentUserId) {
          return { status: "target_not_eligible" };
        }
        const session = await unit.support.findSession(
          discovered.supportSessionId, true,
        );
        const claim = await unit.supportAgentQueue.findClaim(input.claimId, true);
        if (!session || !claim || claim.supportSessionId !== session.id) {
          return { status: "not_found" };
        }
        if (claim.status !== "active") return { status: "claim_not_active" };
        if (session.activeAgentClaimId !== claim.id) {
          throw new Error("Support reassignment session binding failed");
        }
        if (claim.version !== input.expectedClaimVersion ||
          session.version !== input.expectedSessionVersion) return { status: "conflict" };
        const queue = await unit.support.findQueue(claim.queueId);
        if (!queue || queue.status !== "active") return { status: "conflict" };
        const terminated = await unit.supportAgentQueue.terminateClaim({
          claimId: claim.id, expectedVersion: claim.version, status: "reassigned",
          releasedAt: input.now, releasedBy: input.context.actorUserId,
          releaseReason: "reassigned", idempotencyKey: input.idempotencyKey,
          requestHash,
        });
        if (terminated.status !== "updated") return { status: "conflict" };
        const handoff = await unit.support.transition({ sessionId: session.id,
          status: "handoff_requested", expectedVersion: session.version,
          occurredAt: input.now });
        if (handoff.status !== "updated") {
          throw new Error("Support reassignment release failed");
        }
        const created = await unit.supportAgentQueue.createClaim({ id: randomUUID(),
          supportSessionId: session.id, queueId: queue.id,
          agentUserId: target.userId, idempotencyKey: input.idempotencyKey,
          requestHash, reassignedFromClaimId: claim.id, claimedAt: input.now,
          leaseExpiresAt: plusSeconds(input.now, queue.claimLeaseSeconds) });
        if (created.status !== "created") {
          throw new Error("Support reassignment claim creation failed");
        }
        const activated = await unit.support.transition({ sessionId: session.id,
          status: "human_active", expectedVersion: handoff.session.version,
          occurredAt: input.now, assignedUserId: target.userId,
          activeAgentClaimId: created.claim.id });
        if (activated.status !== "updated") {
          throw new Error("Support reassignment activation failed");
        }
        await audit(unit, input.context, { action: "support.claim.reassign",
          resourceType: "support_agent_claim", resourceId: created.claim.id,
          createdAt: input.now, details: { previousClaimId: claim.id,
            sessionId: session.id, fromUserId: claim.agentUserId,
            targetUserId: target.userId } });
        return { status: "reassigned", previousClaim: terminated.claim,
          claim: created.claim, session: activated.session };
      });
    },
  };
}

function isManager(role: string | undefined) {
  return role === "owner" || role === "admin" || role === "support_manager";
}
function isSupportRole(role: string) {
  return isManager(role) || role === "support_agent";
}
function canControl(role: string | undefined, actorUserId: string, agentUserId: string) {
  return actorUserId === agentUserId || isManager(role);
}
function plusSeconds(value: string, seconds: number) {
  return new Date(Date.parse(value) + seconds * 1_000).toISOString();
}
function derivedKey(prefix: string, hash: string) {
  return `${prefix}:${hash.slice(0, 64)}`;
}
async function audit(
  unit: Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0],
  context: Parameters<typeof createEnterpriseAuditEvent>[0]["context"],
  event: { action: string; resourceType: string; resourceId: string;
    createdAt: string; details: Record<string, unknown> },
) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
    context, action: event.action, resourceType: event.resourceType,
    resourceId: event.resourceId, result: "completed",
    details: event.details, createdAt: event.createdAt,
  }));
}
