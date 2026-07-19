import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import type { EnterpriseSupportAiSpeechFence } from
  "../../modules/enterprise/enterprise-support-workbench.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { loadEnterprisePostgresSupportAggregate } from
  "./enterprise-postgres-support-runtime.js";
import { withEnterprisePostgresUnitOfWork, type EnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Pick<EnterpriseRepositoryRuntime,
  "activateSupportWorkbench" | "getSupportWorkbench">;

export function createEnterprisePostgresSupportWorkbenchRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    activateSupportWorkbench(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        await unit.supportAgents.findLatestRunForSession(input.sessionId, true);
        const access = await workbenchAccess(unit, input.sessionId, input.now, input.context);
        if (access.status !== "ready") return access;
        const stopped = await stopEnterpriseSupportAgent(unit, access.session.id, input.now);
        if (stopped.changed) {
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "support.workbench.activate",
            resourceType: "support_session",
            resourceId: access.session.id,
            result: "completed",
            details: {
              claimId: access.claim.id,
              aiSpeechFence: stopped.fence.status,
              ...(stopped.fence.runId ? { runId: stopped.fence.runId } : {}),
            },
            createdAt: input.now,
          }));
        }
        return { status: "ready" as const,
          workbench: await loadWorkbench(
            unit, access.session, access.claim, stopped.fence, input.now,
          ) };
      });
    },
    getSupportWorkbench(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const access = await workbenchAccess(unit, input.sessionId, input.now, input.context);
        if (access.status !== "ready") return access;
        const run = await unit.supportAgents.findLatestRunForSession(access.session.id);
        const fence = speechFence(run, input.now);
        if (!fence) return { status: "ai_stop_not_verified" as const };
        return { status: "ready" as const,
          workbench: await loadWorkbench(
            unit, access.session, access.claim, fence, input.now,
          ) };
      });
    },
  };
}

export async function stopEnterpriseSupportAgent(
  unit: EnterprisePostgresUnitOfWork,
  sessionId: string,
  verifiedAt: string,
) {
  const run = await unit.supportAgents.findLatestRunForSession(sessionId, true);
  const existing = speechFence(run, verifiedAt);
  if (existing) return { fence: existing, changed: false };
  if (!run) throw new Error("Support Agent fence lost run");
  const finalized = await unit.supportAgents.finalizeRun({
    runId: run.id, status: "cancelled", finalizedAt: verifiedAt,
  });
  if (finalized.status !== "cancelled") {
    throw new Error("Support Agent takeover cancellation failed");
  }
  const fence: EnterpriseSupportAiSpeechFence = {
    status: "stopped", runId: finalized.run.id,
    runStatus: finalized.run.status, verifiedAt,
  };
  return { fence, changed: true };
}

async function workbenchAccess(
  unit: EnterprisePostgresUnitOfWork,
  sessionId: string,
  now: string,
  context: { actorRole?: string; actorUserId: string },
) {
  const session = await unit.support.findSession(sessionId, true);
  if (!session) return { status: "not_found" as const };
  if (session.status !== "human_active" || !session.activeAgentClaimId) {
    return { status: "not_active" as const };
  }
  const claim = await unit.supportAgentQueue.findClaim(
    session.activeAgentClaimId, true,
  );
  if (!claim || claim.supportSessionId !== session.id) {
    throw new Error("Support workbench active claim invariant failed");
  }
  if (!canControl(context.actorRole, context.actorUserId, claim.agentUserId)) {
    return { status: "forbidden" as const };
  }
  if (claim.status !== "active") return { status: "claim_not_active" as const };
  if (claim.leaseExpiresAt <= now) return { status: "claim_expired" as const };
  return { status: "ready" as const, session, claim };
}

async function loadWorkbench(
  unit: EnterprisePostgresUnitOfWork,
  session: NonNullable<Awaited<ReturnType<EnterprisePostgresUnitOfWork["support"]["findSession"]>>>,
  claim: NonNullable<Awaited<ReturnType<EnterprisePostgresUnitOfWork["supportAgentQueue"]["findClaim"]>>>,
  aiSpeechFence: EnterpriseSupportAiSpeechFence,
  generatedAt: string,
) {
  const aggregate = await loadEnterprisePostgresSupportAggregate(unit, session);
  const agentRun = await unit.supportAgents.findLatestRunForSession(session.id);
  const [agentTurns, highRiskHandoffs, transcriptSegments] = await Promise.all([
    agentRun ? unit.supportAgents.listTurnsForRun(agentRun.id) : [],
    unit.supportHighRiskHandoffs.listForSession(session.id),
    aggregate.communicationBinding
      ? unit.supportWorkbench.listTranscriptSegments(
          aggregate.communicationBinding.communicationSessionId,
        )
      : [],
  ]);
  return { generatedAt, aggregate, claim, aiSpeechFence,
    ...(agentRun ? { agentRun } : {}),
    conversationContext: agentRun ? [...agentRun.contextDocument] : [],
    agentTurns, highRiskHandoffs, transcriptSegments };
}

function speechFence(
  run: Awaited<ReturnType<EnterprisePostgresUnitOfWork["supportAgents"]["findRun"]>>,
  verifiedAt: string,
): EnterpriseSupportAiSpeechFence | null {
  if (!run) return { status: "not_started", verifiedAt };
  if (run.status === "cancelled") {
    return { status: "stopped", runId: run.id, runStatus: run.status, verifiedAt };
  }
  if (run.status === "completed" || run.status === "failed") {
    return { status: "terminal", runId: run.id, runStatus: run.status, verifiedAt };
  }
  return null;
}

function canControl(role: string | undefined, actorUserId: string, agentUserId: string) {
  return actorUserId === agentUserId || role === "owner" || role === "admin" ||
    role === "support_manager";
}
