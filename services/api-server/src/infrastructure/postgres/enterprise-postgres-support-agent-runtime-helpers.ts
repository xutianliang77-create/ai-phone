import { createHash } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseMeetingRuntimeReadiness } from
  "../../modules/enterprise/enterprise-meeting-runtime-readiness.js";
import { enterpriseSupportAgentRequestHash } from
  "../../modules/enterprise/enterprise-support-agent.js";
import type { EnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseWorkerDispatchTicketPayload } from
  "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import type { EnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function supportAgentRuntimeReadiness(now: Date) {
  return enterpriseMeetingRuntimeReadiness({ ...process.env,
    ENTERPRISE_MEETING_RUNTIME_READINESS_JSON:
      process.env.ENTERPRISE_SUPPORT_AGENT_RUNTIME_READINESS_JSON }, now);
}

export function supportAgentTurnHashes(
  customerText: string,
  context: unknown,
  resolution: { evidence: Array<{ citation: string; contentHash: string }> },
) {
  return {
    customerTextHash: createHash("sha256").update(customerText).digest("hex"),
    contextHash: enterpriseSupportAgentRequestHash(context),
    evidenceHash: enterpriseSupportAgentRequestHash(
      resolution.evidence.map((item) => ({
        citation: item.citation, contentHash: item.contentHash,
      })),
    ),
  };
}

export async function auditSupportAgentRag(
  unit: EnterprisePostgresUnitOfWork,
  context: EnterpriseTenantContext,
  sessionId: string,
  resolution: { evidence: Array<{ knowledgeVersionId: string; blockId: string;
    citation: string; contentHash: string }> },
  now: Date,
) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
    context, action: "support.agent.rag", resourceType: "support_session",
    resourceId: sessionId, result: "completed",
    details: { resultCount: resolution.evidence.length }, createdAt: now.toISOString(),
  }));
  for (const item of resolution.evidence) {
    await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
      context, action: "support.agent.evidence", resourceType: "support_session",
      resourceId: sessionId, result: "completed", details: {
        knowledgeVersionId: item.knowledgeVersionId, blockId: item.blockId,
        citation: item.citation, contentHash: item.contentHash,
      }, createdAt: now.toISOString(),
    }));
  }
}

export async function auditSupportAgent(
  unit: EnterprisePostgresUnitOfWork,
  context: EnterpriseTenantContext,
  action: string,
  resourceId: string,
  details: Record<string, unknown>,
  now: Date,
) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context, action,
    resourceType: "support_session", resourceId, result: "completed", details,
    createdAt: now.toISOString() }));
}

export function supportAgentTicketPayload(grant: {
  id: string; tenantId: string; communicationSessionId: string;
  policySnapshotId: string; policyVersion: string; entitlementVersion: string;
  cellId: string; routeEpoch: number; generation: number;
  capability: "translation_runtime" | "voice_agent_runtime";
  issuedAt: string; expiresAt: string;
}): EnterpriseWorkerDispatchTicketPayload {
  return { v: 3, ticketId: grant.id, tenantId: grant.tenantId,
    communicationSessionId: grant.communicationSessionId,
    policySnapshotId: grant.policySnapshotId, policyVersion: grant.policyVersion,
    entitlementVersion: grant.entitlementVersion, cellId: grant.cellId,
    routeEpoch: grant.routeEpoch, generation: grant.generation,
    capability: grant.capability, issuedAt: grant.issuedAt, expiresAt: grant.expiresAt };
}

export function supportAgentWorkerSigningSecret() {
  const value = process.env.ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET?.trim() ?? "";
  return Buffer.byteLength(value) >= 32 ? value : null;
}
export function supportAgentName() {
  return process.env.LIVEKIT_ENTERPRISE_SUPPORT_AGENT_NAME?.trim() ||
    "enterprise-support-agent";
}
export function supportAgentRoomName(id: string) {
  return `ent_${id.replaceAll("-", "")}`;
}
export function supportAgentLeaseSeconds() {
  return envInt("ENTERPRISE_SUPPORT_AGENT_WORKER_LEASE_SECONDS", 45, 15, 300);
}
export function supportAgentTicketTtlSeconds() {
  return envInt("ENTERPRISE_SUPPORT_AGENT_TICKET_TTL_SECONDS", 300, 30, 300);
}
export function supportAgentDate(value: string) {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime()) || result.toISOString() !== value) {
    throw new Error("Invalid Support Agent time");
  }
  return result;
}
export function supportAgentNotReady(reasonCode: string) {
  return { status: "not_ready" as const, reasonCode };
}
function envInt(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
