import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseMarketingHandoffEvidenceDto } from
  "../../modules/enterprise/enterprise-marketing-handoff.js";
import { createEnvironmentEnterpriseMarketingHandoffProvider,
  type EnterpriseMarketingHandoffProvider } from
  "../../modules/enterprise/enterprise-marketing-handoff-provider.js";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import { createEnterpriseSupportWriteCommandService,
  type EnterpriseSupportWriteCommandService } from
  "../../modules/enterprise/enterprise-support-write-command.js";
import type { EnterpriseSupportAiSpeechFence } from
  "../../modules/enterprise/enterprise-support-workbench.js";
import { unavailableEnterpriseSupportWriteAdapter } from
  "../../modules/enterprise/enterprise-support-write-tool.js";
import { loadEnterprisePostgresSupportAggregate } from
  "./enterprise-postgres-support-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork,
  type EnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Pick<EnterpriseRepositoryRuntime,
  "activateSupportWorkbench" | "getSupportWorkbench">;

export function createEnterprisePostgresSupportWorkbenchRuntime(
  pool: EnterpriseTenantPostgresPool,
  command: EnterpriseSupportWriteCommandService =
    createEnterpriseSupportWriteCommandService({
      adapter: unavailableEnterpriseSupportWriteAdapter(),
    }),
  handoffProvider: EnterpriseMarketingHandoffProvider =
    createEnvironmentEnterpriseMarketingHandoffProvider(),
): Runtime {
  return {
    async activateSupportWorkbench(input) {
      const prepared = await withEnterprisePostgresUnitOfWork(
        pool, input.context, async (unit) => {
          await unit.supportAgents.findLatestRunForSession(input.sessionId, true);
          const access = await workbenchAccess(
            unit, input.sessionId, input.now, input.context);
          if (access.status !== "ready") return access;
          const stopped = await stopEnterpriseSessionAi(
            unit, access.session.id, input.now);
          return { ...access, ...stopped,
            marketingHandoff: "marketingHandoff" in stopped
              ? stopped.marketingHandoff : undefined };
        });
      if (prepared.status !== "ready") return prepared;
      let mediaStatus: string | undefined;
      let verifiedAt = input.now;
      if (prepared.marketingHandoff && prepared.fence.status === "stopped" &&
        prepared.marketingHandoff.status !== "active") {
        const readiness = handoffProvider.readiness();
        if (readiness.status === "ready" &&
          Date.parse(prepared.claim.leaseExpiresAt) <= Date.parse(input.now) + 1_000) {
          return { status: "claim_expired" as const };
        }
        const result = readiness.status === "ready"
          ? await handoffProvider.activate({ tenantId: input.context.tenantId,
            handoffId: prepared.marketingHandoff.id,
            dispatchId: prepared.marketingHandoff.dispatchId,
            communicationSessionId: prepared.marketingHandoff.communicationSessionId,
            supportSessionId: prepared.session.id, claimId: prepared.claim.id,
            agentUserId: prepared.claim.agentUserId, requestedAt: input.now,
            idempotencyKey: "marketing-handoff:" + prepared.marketingHandoff.id +
              ":" + prepared.claim.id })
          : { status: readiness.status, reasonCode: readiness.reasonCode ??
              "marketing_handoff_provider_not_ready" } as const;
        verifiedAt = new Date().toISOString();
        const stored = await withEnterprisePostgresUnitOfWork(
          pool, input.context, async (unit) => {
            const access = await workbenchAccess(
              unit, input.sessionId, verifiedAt, input.context);
            if (access.status !== "ready") return access;
            const record = await unit.marketingHandoffs.recordMedia({
              handoffId: prepared.marketingHandoff!.id, requestedAt: input.now,
              result: result.status === "completed"
                ? { status: "active",
                  aiAudioStoppedAt: result.aiAudioStoppedAt,
                  operatorJoinedAt: result.operatorJoinedAt,
                  providerFingerprint: result.providerFingerprint,
                  receiptHash: result.receiptHash }
                : { status: result.status === "failed" && [
                    "marketing_handoff_provider_unauthorized",
                    "marketing_handoff_provider_conflict",
                    "marketing_handoff_invalid_receipt",
                  ].includes(result.reasonCode) ? "failed" : "media_not_ready",
                  reasonCode: result.reasonCode },
            });
            if (!("handoff" in record) || !record.handoff) {
              throw new Error("Marketing handoff media receipt rejected: " +
                record.status);
            }
            return { status: "ready" as const, handoff: record.handoff };
          });
        if (stored.status !== "ready") return stored;
        mediaStatus = stored.handoff.status;
      }
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const access = await workbenchAccess(
          unit, input.sessionId, verifiedAt, input.context);
        if (access.status !== "ready") return access;
        const stopped = await stopEnterpriseSessionAi(unit, access.session.id, verifiedAt);
        if (stopped.changed || mediaStatus) await unit.tenant.appendAuditEvent(
          createEnterpriseAuditEvent({
          context: input.context, action: "support.workbench.activate",
          resourceType: "support_session", resourceId: access.session.id,
          result: "completed", details: { claimId: access.claim.id,
            aiSpeechFence: stopped.fence.status,
            aiSpeechSource: stopped.fence.source ?? "support_agent",
            ...(stopped.fence.runId ? { runId: stopped.fence.runId } : {}),
            ...(mediaStatus ? { marketingHandoffMediaStatus: mediaStatus } : {}) },
          createdAt: verifiedAt }));
        return { status: "ready" as const,
          workbench: await loadWorkbench(unit, access.session, access.claim,
            stopped.fence, verifiedAt, command.readiness(input.context.tenantId)) };
      });
    },
    getSupportWorkbench(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const access = await workbenchAccess(
          unit, input.sessionId, input.now, input.context);
        if (access.status !== "ready") return access;
        const fence = await sessionSpeechFence(unit, access.session.id, input.now);
        if (!fence) return { status: "ai_stop_not_verified" as const };
        return { status: "ready" as const,
          workbench: await loadWorkbench(unit, access.session, access.claim, fence,
            input.now, command.readiness(input.context.tenantId)) };
      });
    },
  };
}

export async function stopEnterpriseSessionAi(
  unit: EnterprisePostgresUnitOfWork,
  sessionId: string,
  verifiedAt: string,
) {
  const marketingHandoff = await unit.marketingHandoffs
    .findBySupportSession(sessionId, true);
  if (marketingHandoff) {
    const run = await unit.marketingAgents.findRun(
      marketingHandoff.marketingAgentRunId, true);
    if (!run || run.communicationSessionId !==
      marketingHandoff.communicationSessionId) {
      throw new Error("Marketing handoff AI fence lost run");
    }
    if (!["handoff_requested", "completed", "failed", "cancelled"]
      .includes(run.status)) {
      throw new Error("Marketing handoff AI fence is not stopped");
    }
    const fence: EnterpriseSupportAiSpeechFence = {
      status: run.status === "handoff_requested" ? "stopped" : "terminal",
      source: "marketing_agent", runId: run.id, runStatus: run.status,
      verifiedAt: run.status === "handoff_requested"
        ? marketingHandoff.aiFencedAt : run.updatedAt };
    return { fence, changed: false, marketingHandoff };
  }
  return stopEnterpriseSupportAgent(unit, sessionId, verifiedAt);
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
  const fence: EnterpriseSupportAiSpeechFence = { status: "stopped",
    source: "support_agent", runId: finalized.run.id,
    runStatus: finalized.run.status, verifiedAt };
  return { fence, changed: true };
}

export async function workbenchAccess(
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
    session.activeAgentClaimId, true);
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
  session: NonNullable<Awaited<ReturnType<
    EnterprisePostgresUnitOfWork["support"]["findSession"]>>>,
  claim: NonNullable<Awaited<ReturnType<
    EnterprisePostgresUnitOfWork["supportAgentQueue"]["findClaim"]>>>,
  aiSpeechFence: EnterpriseSupportAiSpeechFence,
  generatedAt: string,
  followupReadiness: ReturnType<EnterpriseSupportWriteCommandService["readiness"]>,
) {
  const aggregate = await loadEnterprisePostgresSupportAggregate(unit, session);
  const [agentRun, marketingHandoff] = await Promise.all([
    unit.supportAgents.findLatestRunForSession(session.id),
    unit.marketingHandoffs.findBySupportSession(session.id),
  ]);
  const [agentTurns, highRiskHandoffs, transcriptSegments] = await Promise.all([
    agentRun ? unit.supportAgents.listTurnsForRun(agentRun.id) : [],
    unit.supportHighRiskHandoffs.listForSession(session.id),
    marketingHandoff
      ? unit.supportWorkbench.listTranscriptSegments(
          marketingHandoff.communicationSessionId)
      : aggregate.communicationBinding
        ? unit.supportWorkbench.listTranscriptSegments(
            aggregate.communicationBinding.communicationSessionId)
        : [],
  ]);
  return { generatedAt, aggregate, claim, aiSpeechFence, followupReadiness,
    ...(marketingHandoff
      ? { marketingHandoff: enterpriseMarketingHandoffEvidenceDto(marketingHandoff) } : {}),
    ...(agentRun ? { agentRun } : {}),
    conversationContext: agentRun ? [...agentRun.contextDocument] : [],
    agentTurns, highRiskHandoffs, transcriptSegments };
}

async function sessionSpeechFence(unit: EnterprisePostgresUnitOfWork,
  sessionId: string, verifiedAt: string) {
  const handoff = await unit.marketingHandoffs.findBySupportSession(sessionId);
  if (handoff) { const run = await unit.marketingAgents.findRun(
    handoff.marketingAgentRunId);
    if (!run || !["handoff_requested", "completed", "failed", "cancelled"]
      .includes(run.status)) return null;
    const fence: EnterpriseSupportAiSpeechFence = {
      status: run.status === "handoff_requested" ? "stopped" : "terminal",
      source: "marketing_agent", runId: run.id, runStatus: run.status,
      verifiedAt: run.status === "handoff_requested"
        ? handoff.aiFencedAt : run.updatedAt };
    return fence;
  }
  return speechFence(
    await unit.supportAgents.findLatestRunForSession(sessionId), verifiedAt);
}
function speechFence(run: Awaited<ReturnType<EnterprisePostgresUnitOfWork[
  "supportAgents"]["findRun"]>>, verifiedAt: string):
  EnterpriseSupportAiSpeechFence | null {
  if (!run) return { status: "not_started", source: "support_agent", verifiedAt };
  if (run.status === "cancelled") return { status: "stopped",
    source: "support_agent", runId: run.id, runStatus: run.status, verifiedAt };
  if (run.status === "completed" || run.status === "failed") return {
    status: "terminal", source: "support_agent", runId: run.id,
    runStatus: run.status, verifiedAt };
  return null;
}
function canControl(role: string | undefined, actorUserId: string, agentUserId: string) {
  return actorUserId === agentUserId || role === "owner" || role === "admin" ||
    role === "support_manager";
}
