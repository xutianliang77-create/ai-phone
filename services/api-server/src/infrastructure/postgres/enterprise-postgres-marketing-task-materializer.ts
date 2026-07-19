import { enterprisePostgresActorSubjectId } from
  "./enterprise-postgres-subject-id.js";
import { marketingTaskGenerationHash, marketingTaskIdentity,
  type EnterpriseMarketingPreparedTask } from
  "../../modules/enterprise/enterprise-marketing-scheduler.js";
import type { EnterpriseCampaignRecord } from
  "../../modules/enterprise/enterprise-campaign.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export async function prepareEnterpriseMarketingTasks(
  session: EnterpriseTenantPostgresSession,
  campaign: EnterpriseCampaignRecord,
) {
  if (!campaign.approvalSnapshotId || !campaign.schedule.startAt) {
    return { status: "snapshot_invalid" as const };
  }
  const startAt = iso(campaign.schedule.startAt);
  const horizon = new Date(Date.parse(startAt) + 8 * 24 * 60 * 60 * 1_000).toISOString();
  const searchEnd = campaign.schedule.endAt && campaign.schedule.endAt < horizon
    ? iso(campaign.schedule.endAt) : horizon;
  const result = await session.query<PreparedRow>(`
    WITH frozen AS (
      SELECT validation.lead_set, validation.consent_set, validation.policy_set,
        jsonb_array_length(validation.lead_set) AS expected_count
      FROM enterprise.marketing_campaign_approval_decisions decision
      JOIN enterprise.marketing_campaign_validation_snapshots validation
        ON validation.tenant_id = decision.tenant_id
        AND validation.id = decision.validation_snapshot_id
      WHERE decision.tenant_id = $1 AND decision.id = $2
        AND decision.campaign_id = $3 AND decision.decision = 'approved'
        AND validation.status = 'ready'
    ), targets AS (
      SELECT lead.item AS lead_item, consent.item AS consent_item,
        policy.item AS policy_item
      FROM frozen
      CROSS JOIN LATERAL jsonb_array_elements(frozen.lead_set) lead(item)
      JOIN LATERAL jsonb_array_elements(frozen.consent_set) consent(item)
        ON consent.item ->> 'leadId' = lead.item ->> 'leadId'
      JOIN LATERAL jsonb_array_elements(frozen.policy_set) policy(item)
        ON policy.item ->> 'countryCode' = lead.item ->> 'countryCode'
    ), slots AS (
      SELECT target.lead_item ->> 'leadId' AS lead_id,
        target.policy_item ->> 'policyId' AS policy_id, slot.scheduled_at
      FROM targets target
      JOIN enterprise.marketing_country_policy_versions policy
        ON policy.tenant_id = $1
        AND policy.id = (target.policy_item ->> 'policyId')::uuid
      CROSS JOIN LATERAL (
        SELECT candidate.scheduled_at
        FROM generate_series($4::timestamptz, LEAST($5::timestamptz,
          policy.expires_at, COALESCE(
            (target.consent_item ->> 'expiresAt')::timestamptz,
            $5::timestamptz)), interval '1 minute') candidate(scheduled_at)
        WHERE candidate.scheduled_at < $5::timestamptz
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(policy.calling_windows) window(item)
            WHERE (window.item ->> 'weekday')::integer = extract(isodow FROM
                candidate.scheduled_at AT TIME ZONE (target.lead_item ->> 'timezone'))::integer
              AND (window.item ->> 'startMinute')::integer <=
                extract(hour FROM candidate.scheduled_at AT TIME ZONE
                  (target.lead_item ->> 'timezone'))::integer * 60 +
                extract(minute FROM candidate.scheduled_at AT TIME ZONE
                  (target.lead_item ->> 'timezone'))::integer
              AND (window.item ->> 'endMinute')::integer >
                extract(hour FROM candidate.scheduled_at AT TIME ZONE
                  (target.lead_item ->> 'timezone'))::integer * 60 +
                extract(minute FROM candidate.scheduled_at AT TIME ZONE
                  (target.lead_item ->> 'timezone'))::integer
          )
        ORDER BY candidate.scheduled_at LIMIT 1
      ) slot
    )
    SELECT frozen.expected_count, slots.lead_id, slots.policy_id, slots.scheduled_at
    FROM frozen LEFT JOIN slots ON true ORDER BY slots.scheduled_at, slots.lead_id
  `, [uuid(campaign.approvalSnapshotId), uuid(campaign.id), startAt, searchEnd]);
  const expected = number(result.rows[0]?.expected_count);
  const slots = result.rows.filter((row) => row.lead_id && row.policy_id && row.scheduled_at);
  if (!expected) return { status: "snapshot_invalid" as const };
  if (slots.length !== expected) return { status: "calling_window_unavailable" as const };
  const tasks = slots.map((row) => prepared(campaign, row));
  return { status: "ready" as const, tasks };
}

export async function insertEnterpriseMarketingTasks(
  session: EnterpriseTenantPostgresSession,
  campaign: EnterpriseCampaignRecord,
  tasks: EnterpriseMarketingPreparedTask[],
  generatedAt: string,
) {
  const result = await session.query<{ id: string }>(`
    INSERT INTO enterprise.marketing_call_tasks(
      tenant_id, id, campaign_id, lead_id, scheduled_at, status, attempt,
      idempotency_key, outcome_code, claimed_at, version,
      country_policy_version_id, approval_snapshot_id, generation_hash,
      generated_by, generated_at, dispatch_generation, created_at, updated_at
    ) SELECT $1, item.id, item.campaign_id, item.lead_id, item.scheduled_at,
      'scheduled', 1, item.idempotency_key, NULL, NULL, 1,
      item.country_policy_version_id, item.approval_snapshot_id,
      item.generation_hash, $3, $4, 0, $4, $4
    FROM jsonb_to_recordset($2::jsonb) AS item(
      id uuid, campaign_id uuid, lead_id uuid, scheduled_at timestamptz,
      idempotency_key text, country_policy_version_id uuid,
      approval_snapshot_id uuid, generation_hash text
    ) RETURNING id
  `, [JSON.stringify(tasks.map((task) => ({ id: task.id,
    campaign_id: task.campaignId, lead_id: task.leadId,
    scheduled_at: task.scheduledAt, idempotency_key: task.idempotencyKey,
    country_policy_version_id: task.countryPolicyVersionId,
    approval_snapshot_id: task.approvalSnapshotId,
    generation_hash: task.generationHash }))),
    enterprisePostgresActorSubjectId(session.context.actorUserId), iso(generatedAt)]);
  if (result.rows.length !== tasks.length) throw new Error("Marketing task generation conflict");
  return result.rows.length;
}

interface PreparedRow extends Record<string, unknown> { expected_count: number | string;
  lead_id: string | null; policy_id: string | null; scheduled_at: string | Date | null; }
function prepared(campaign: EnterpriseCampaignRecord, row: PreparedRow) {
  const leadId = uuid(row.lead_id); const scheduledAt = iso(row.scheduled_at);
  const countryPolicyVersionId = uuid(row.policy_id);
  const approvalSnapshotId = uuid(campaign.approvalSnapshotId);
  const input = { campaignId: campaign.id, leadId, scheduledAt,
    approvalSnapshotId, countryPolicyVersionId, attempt: 1 };
  return { ...input, id: marketingTaskIdentity({ tenantId: campaign.tenantId,
    campaignId: campaign.id, approvalSnapshotId, leadId, attempt: 1 }),
    idempotencyKey: `scheduler:${approvalSnapshotId}:${leadId}:1`,
    generationHash: marketingTaskGenerationHash(input) };
}
function uuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid scheduler UUID"); return value; }
function iso(value: unknown) { const result = value instanceof Date ? value.toISOString() : value; if (typeof result !== "string" || new Date(result).toISOString() !== result) throw new Error("Invalid scheduler timestamp"); return result; }
function number(value: unknown) { const result = Number(value); return Number.isSafeInteger(result) && result > 0 ? result : 0; }
