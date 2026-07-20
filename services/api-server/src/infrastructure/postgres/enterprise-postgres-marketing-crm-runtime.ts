import { createHash, randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMarketingCrmCommandService } from
  "../../modules/enterprise/enterprise-marketing-crm-command.js";
import { createEnvironmentEnterpriseMarketingCrmCommandService } from
  "../../modules/enterprise/enterprise-marketing-crm-command.js";
import type { EnterpriseMarketingCrmRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-crm-runtime.js";
import type { EnterpriseMarketingCrmPublishReceipt,
  EnterpriseMarketingCrmSyncRecord } from
  "../../modules/enterprise/enterprise-marketing-crm.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function createEnvironmentEnterprisePostgresMarketingCrmRuntime(
  pool: EnterpriseTenantPostgresPool,
) { return createEnterprisePostgresMarketingCrmRuntime(pool,
  createEnvironmentEnterpriseMarketingCrmCommandService()); }

export function createEnterprisePostgresMarketingCrmRuntime(
  pool: EnterpriseTenantPostgresPool, command: EnterpriseMarketingCrmCommandService,
): Required<EnterpriseMarketingCrmRepositoryRuntime> {
  return {
    listMarketingCrmSyncs(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) return { status: "not_found" as const };
        const result = await unit.marketingCrm.list(input.campaignId, 101);
        const records = result.records.slice(0, 100);
        return { status: "ready" as const, result: { campaignId: input.campaignId,
          generatedAt: input.now.toISOString(), counts: {
            pending: result.counts.pending, synced: result.counts.synced,
            failed: result.counts.failed },
          syncs: records.map(dto), truncated: result.count > 100 } };
      });
    },
    requestMarketingCrmSync(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) return { status: "not_found" as const };
        const requestHash = digest({ actorUserId: input.context.actorUserId,
          campaignId: input.campaignId, outcomeId: input.outcomeId,
          expectedOutcomeVersion: input.expectedOutcomeVersion });
        const replay = await unit.marketingCrm.byIdempotency(
          input.context.actorUserId, input.idempotencyKey);
        if (replay) return replay.requestHash === requestHash
          ? { status: "replayed" as const, sync: replay }
          : { status: "idempotency_conflict" as const };
        const outcome = await unit.marketingOutcomes.find(input.outcomeId);
        if (!outcome || outcome.campaignId !== input.campaignId) {
          return { status: "not_found" as const };
        }
        if (outcome.version !== input.expectedOutcomeVersion) {
          return { status: "conflict" as const };
        }
        const prior = await unit.marketingCrm.byOutcome(input.outcomeId);
        if (prior) return { status: "already_requested" as const };
        const syncId = randomUUID(); const eventId = randomUUID();
        const prepared = command.prepare({ tenantId: input.context.tenantId,
          syncId, outcome });
        if (prepared.status !== "ready") return { status: "not_configured" as const,
          reasonCode: prepared.reasonCode };
        const created = await unit.marketingCrm.create({ id: syncId,
          campaignId: input.campaignId, outcomeId: input.outcomeId,
          externalRecordKey: prepared.externalRecordKey,
          objectApiName: prepared.objectApiName, payloadHash: prepared.payloadHash,
          providerFingerprint: prepared.providerFingerprint, requestHash,
          idempotencyKey: input.idempotencyKey, outboxEventId: eventId,
          now: input.now.toISOString() });
        if (created.status !== "created") return created.status === "replayed"
          ? created : { status: created.status as "conflict" | "already_requested" |
              "idempotency_conflict" };
        const event = await unit.events.insertOutbox({ id: eventId,
          tenantId: input.context.tenantId, aggregateType: "marketing_crm_sync",
          aggregateId: syncId, eventType: "marketing.crm.sync.requested",
          idempotencyKey: `marketing-crm-sync:${syncId}`,
          payload: prepared.outboxPayload, traceId: input.context.traceId, attempts: 0,
          availableAt: input.now.toISOString(), createdAt: input.now.toISOString() });
        if (event.status !== "created") throw new Error(
          "Marketing CRM outbox event already exists");
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "marketing.crm_sync.request",
          resourceType: "marketing_crm_sync", resourceId: syncId,
          result: "completed", details: { campaignId: input.campaignId,
            outcomeId: input.outcomeId, provider: prepared.provider,
            externalRecordKey: prepared.externalRecordKey,
            payloadHash: prepared.payloadHash }, createdAt: input.now.toISOString() }));
        return created;
      });
    },
    finalizeMarketingCrmOutbox(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const sync = await unit.marketingCrm.byOutboxEvent(input.eventId);
        if (!sync || sync.status !== "pending") return { status: "conflict" as const };
        const normalized = normalize(input.result, sync.id);
        const updated = await unit.marketingCrm.finalize({ syncId: sync.id,
          outboxEventId: input.eventId, attempt: input.attempt,
          result: normalized.sync, now: input.now.toISOString() });
        if (updated.status !== "updated") return { status: "conflict" as const };
        const retryAt = new Date(input.now.getTime() + Math.min(
          1_000 * 2 ** Math.max(0, input.attempt - 1), 300_000)).toISOString();
        const event = await unit.events.finalizeOutbox({ eventId: input.eventId,
          attempt: input.attempt, availableAt: normalized.published
            ? input.now.toISOString() : retryAt,
          ...(normalized.published ? { publishedAt: input.now.toISOString() }
            : { lastErrorCode: normalized.reasonCode }) });
        if (event.status !== "updated") throw new Error(
          "Marketing CRM outbox finalize conflict");
        if (normalized.published) await unit.tenant.appendAuditEvent(
          createEnterpriseAuditEvent({ context: input.context,
            action: normalized.sync.status === "synced"
              ? "marketing.crm_sync.complete" : "marketing.crm_sync.fail",
            resourceType: "marketing_crm_sync", resourceId: sync.id,
            result: normalized.sync.status === "synced" ? "completed" : "failed",
            details: { campaignId: sync.campaignId, outcomeId: sync.outcomeId,
              provider: sync.provider, attempts: input.attempt,
              ...("reasonCode" in normalized
                ? { reasonCode: normalized.reasonCode } : {}) },
            createdAt: input.now.toISOString() }));
        return { status: normalized.published ? "completed" as const : "retried" as const };
      });
    },
  };
}

function normalize(result: Parameters<NonNullable<EnterpriseMarketingCrmRepositoryRuntime[
  "finalizeMarketingCrmOutbox"]>>[0]["result"], syncId: string) {
  if (result.status === "retry") { const reasonCode = code(result.reason); return {
    published: false as const, reasonCode,
    sync: { status: "retry" as const, reasonCode } }; }
  const receipt = result.receipt;
  if (!receipt || receipt.kind !== "marketing_crm" || receipt.syncId !== syncId) {
    const reasonCode = "crm_provider_receipt_invalid"; return { published: false as const,
      reasonCode, sync: { status: "retry" as const, reasonCode } };
  }
  return receipt.outcome === "synced" ? synced(receipt) : { published: true as const,
    reasonCode: code(receipt.reasonCode),
    sync: { status: "failed" as const, reasonCode: code(receipt.reasonCode) } };
}
function synced(receipt: Extract<EnterpriseMarketingCrmPublishReceipt,
  { outcome: "synced" }>) { return { published: true as const,
  sync: { status: "synced" as const, providerRecordId: receipt.providerRecordId,
    providerRecordUrl: receipt.providerRecordUrl,
    providerResponseHash: receipt.providerResponseHash } }; }
function dto(sync: EnterpriseMarketingCrmSyncRecord) { return { id: sync.id,
  campaignId: sync.campaignId, outcomeId: sync.outcomeId, provider: sync.provider,
  status: sync.status, externalRecordKey: sync.externalRecordKey,
  objectApiName: sync.objectApiName,
  ...(sync.providerRecordId ? { providerRecordId: sync.providerRecordId } : {}),
  ...(sync.providerRecordUrl ? { providerRecordUrl: sync.providerRecordUrl } : {}),
  attempts: sync.attempts,
  ...(sync.lastErrorCode ? { lastErrorCode: sync.lastErrorCode } : {}),
  createdAt: sync.createdAt, updatedAt: sync.updatedAt,
  ...(sync.syncedAt ? { syncedAt: sync.syncedAt } : {}), version: sync.version }; }
function code(value: string) { return /^[a-z][a-z0-9_]{1,63}$/.test(value)
  ? value : "crm_provider_failed"; }
function digest(value: unknown) { return createHash("sha256")
  .update(JSON.stringify(value)).digest("hex"); }
