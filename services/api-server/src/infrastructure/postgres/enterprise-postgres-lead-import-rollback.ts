import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";
import {
  eventKey,
  hash,
  mapBatch,
  nextIso,
  timestamp,
  uuid,
  type LeadImportBatchRow,
} from "./enterprise-postgres-lead-import-mappers.js";

export async function rollbackEnterpriseLeadImportBatch(
  session: EnterpriseTenantPostgresSession,
  input: { campaignId: string; batchId: string; expectedVersion: number;
    idempotencyKey: string; requestHash: string; occurredAt: string },
) {
  await session.queryTenantRecord(`
    SELECT id FROM enterprise.tenants WHERE id = $1 FOR UPDATE
  `);
  const found = await session.query<LeadImportBatchRow>(`
    SELECT * FROM enterprise.marketing_lead_import_batches
    WHERE tenant_id = $1 AND campaign_id = $2 AND id = $3
    FOR UPDATE
  `, [uuid(input.campaignId), uuid(input.batchId)]);
  const batch = found.rows[0];
  if (!batch) return { status: "not_found" as const };
  if (batch.status === "rolled_back") {
    const actor = enterprisePostgresAccountSubjectId(session.context.actorUserId);
    return batch.rollback_key === eventKey(input.idempotencyKey) &&
      batch.rollback_request_hash === hash(input.requestHash) &&
      batch.rollback_by === actor
      ? { status: "replayed" as const, batch: mapBatch(batch) }
      : { status: "idempotency_conflict" as const };
  }
  const campaign = await session.query<{ status: string; approval_status: string }>(`
    SELECT status, approval_status FROM enterprise.marketing_campaigns
    WHERE tenant_id = $1 AND id = $2
    FOR UPDATE
  `, [uuid(input.campaignId)]);
  if (!campaign.rows[0]) return { status: "not_found" as const };
  if (campaign.rows[0].status !== "draft" ||
    campaign.rows[0].approval_status !== "not_submitted") {
    return { status: "campaign_not_editable" as const };
  }
  if (batch.status !== "committed" || Number(batch.version) !== input.expectedVersion) {
    return { status: "conflict" as const };
  }
  const occurredAt = nextIso(input.occurredAt, timestamp(batch.updated_at));
  const links = await session.query<{ lead_id: string }>(`
    UPDATE enterprise.marketing_campaign_leads
    SET status = 'rolled_back', rolled_back_at = $4, version = version + 1
    WHERE tenant_id = $1 AND campaign_id = $2 AND import_batch_id = $3
      AND status = 'active'
    RETURNING lead_id
  `, [uuid(input.campaignId), uuid(input.batchId), occurredAt]);
  const leadIds = links.rows.map((row) => uuid(row.lead_id));
  if (leadIds.length > 0) await session.query(`
    UPDATE enterprise.marketing_leads AS lead
    SET status = 'inactive', updated_at = GREATEST($3::timestamptz,
      lead.updated_at + interval '1 millisecond'), version = version + 1
    WHERE lead.tenant_id = $1 AND lead.id = ANY($2::uuid[])
      AND lead.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_campaign_leads active_link
        WHERE active_link.tenant_id = $1 AND active_link.lead_id = lead.id
          AND active_link.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM enterprise.contact_consents consent
        WHERE consent.tenant_id = $1 AND consent.lead_id = lead.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_call_tasks task
        WHERE task.tenant_id = $1 AND task.lead_id = lead.id
      )
  `, [leadIds, occurredAt]);
  const result = await session.query<LeadImportBatchRow>(`
    UPDATE enterprise.marketing_lead_import_batches
    SET status = 'rolled_back', rollback_by = $4, rollback_key = $5,
      rollback_request_hash = $6, rolled_back_at = $7, updated_at = $7,
      version = version + 1
    WHERE tenant_id = $1 AND id = $2 AND campaign_id = $3
      AND status = 'committed' AND version = $8
    RETURNING *
  `, [uuid(input.batchId), uuid(input.campaignId),
    enterprisePostgresAccountSubjectId(session.context.actorUserId),
    eventKey(input.idempotencyKey), hash(input.requestHash), occurredAt,
    input.expectedVersion]);
  if (!result.rows[0]) throw new Error("Lead import rollback conflict after lock");
  return { status: "rolled_back" as const, batch: mapBatch(result.rows[0]) };
}
