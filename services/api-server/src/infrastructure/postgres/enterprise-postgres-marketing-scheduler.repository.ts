import type { EnterpriseMarketingTaskCounts } from "@translation/contracts";
import type { EnterpriseCampaignRecord } from
  "../../modules/enterprise/enterprise-campaign.js";
import type { EnterpriseMarketingSchedulerStatusRecord,
  EnterpriseMarketingTaskRecord } from
  "../../modules/enterprise/enterprise-marketing-scheduler.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMarketingSchedulerPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async status(campaignId: string): Promise<EnterpriseMarketingSchedulerStatusRecord> {
    const result = await this.session.query<StatusRow>(`
      SELECT count(*)::text AS total,
        count(*) FILTER (WHERE status = 'pending')::text AS pending,
        count(*) FILTER (WHERE status = 'scheduled')::text AS scheduled,
        count(*) FILTER (WHERE status = 'dispatching')::text AS dispatching,
        count(*) FILTER (WHERE status = 'dispatched')::text AS dispatched,
        count(*) FILTER (WHERE status = 'answered')::text AS answered,
        count(*) FILTER (WHERE status = 'retry')::text AS retry,
        count(*) FILTER (WHERE status = 'completed')::text AS completed,
        count(*) FILTER (WHERE status = 'failed')::text AS failed,
        count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
        min(scheduled_at) FILTER (WHERE status IN ('scheduled', 'retry')) AS next_due_at,
        (SELECT count(*)::text FROM enterprise.marketing_call_tasks tenant_task
          WHERE tenant_task.tenant_id = $1 AND tenant_task.status IN
            ('dispatching', 'dispatched', 'answered')) AS tenant_active_claims
      FROM enterprise.marketing_call_tasks
      WHERE tenant_id = $1 AND campaign_id = $2
    `, [uuid(campaignId)]);
    const row = result.rows[0]; const counts = taskCounts(row);
    return { counts, activeClaims: counts.dispatching + counts.dispatched + counts.answered,
      tenantActiveClaims: nonnegative(row?.tenant_active_claims),
      ...(row?.next_due_at ? { nextDueAt: iso(row.next_due_at) } : {}) };
  }

  async lockRoute(input: { homeRegion: string; cellId: string; routeEpoch: number }) {
    const result = await this.session.queryTenantRecord<RouteRow>(`
      SELECT id, home_region, cell_id, version FROM enterprise.tenants
      WHERE id = $1 FOR UPDATE
    `);
    const row = result.rows[0];
    return Boolean(row && row.home_region === input.homeRegion &&
      row.cell_id === input.cellId && positive(row.version) === input.routeEpoch);
  }

  async reapExpired(now: string) {
    await this.session.query(`
      UPDATE enterprise.usage_holds hold_record
      SET status = 'expired', released_at = $2, updated_at = $2,
        version = hold_record.version + 1
      FROM enterprise.marketing_call_tasks task
      WHERE hold_record.tenant_id = $1 AND task.tenant_id = hold_record.tenant_id
        AND task.usage_hold_id = hold_record.id AND task.status = 'dispatching'
        AND task.lease_expires_at <= $2 AND hold_record.status = 'held'
        AND NOT EXISTS (
          SELECT 1 FROM enterprise.marketing_pstn_dispatches dispatch
          WHERE dispatch.tenant_id = task.tenant_id AND dispatch.task_id = task.id
            AND dispatch.dispatch_generation = task.dispatch_generation
            AND dispatch.status IN ('prepared', 'unknown', 'accepted', 'answered')
        )
    `, [iso(now)]);
    await this.session.query(`
      UPDATE enterprise.marketing_call_tasks task
      SET status = 'retry', outcome_code = 'scheduler_lease_expired',
        claimed_at = NULL, claim_owner = NULL, claim_token_hash = NULL,
        lease_expires_at = NULL, usage_hold_id = NULL, updated_at = $2,
        version = version + 1
      WHERE task.tenant_id = $1 AND task.status = 'dispatching'
        AND task.lease_expires_at <= $2
        AND NOT EXISTS (
          SELECT 1 FROM enterprise.marketing_pstn_dispatches dispatch
          WHERE dispatch.tenant_id = task.tenant_id
            AND dispatch.task_id = task.id
            AND dispatch.dispatch_generation = task.dispatch_generation
            AND dispatch.status IN ('prepared', 'unknown', 'accepted', 'answered')
        )
    `, [iso(now)]);
  }

  async due(now: string, limit: number) {
    const result = await this.session.query<TaskRow>(`
      SELECT task.* FROM enterprise.marketing_call_tasks task
      JOIN enterprise.marketing_campaigns campaign
        ON campaign.tenant_id = task.tenant_id AND campaign.id = task.campaign_id
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = task.tenant_id AND lead.id = task.lead_id
        AND lead.status = 'active'
      JOIN enterprise.marketing_campaign_leads link
        ON link.tenant_id = task.tenant_id AND link.campaign_id = task.campaign_id
        AND link.lead_id = task.lead_id AND link.status = 'active'
      JOIN enterprise.marketing_country_policy_versions policy
        ON policy.tenant_id = task.tenant_id
        AND policy.id = task.country_policy_version_id
      WHERE task.tenant_id = $1 AND task.status IN ('scheduled', 'retry')
        AND task.scheduled_at <= $2 AND campaign.status IN ('scheduled', 'running')
        AND policy.effective_from <= $2 AND policy.expires_at > $2
        AND enterprise.marketing_campaign_approval_is_current(
          campaign.id, task.approval_snapshot_id)
        AND EXISTS (SELECT 1 FROM enterprise.contact_consents consent
          WHERE consent.tenant_id = task.tenant_id
            AND consent.campaign_id = task.campaign_id AND consent.lead_id = task.lead_id
            AND consent.purpose = 'automated_marketing_call'
            AND consent.granted_at <= task.scheduled_at AND consent.revoked_at IS NULL
            AND (consent.expires_at IS NULL OR consent.expires_at > $2))
        AND NOT EXISTS (SELECT 1 FROM enterprise.suppression_entries suppression
          WHERE suppression.tenant_id = task.tenant_id
            AND suppression.phone_hash = lead.phone_hash
            AND suppression.scope IN ('tenant', 'global'))
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(policy.calling_windows) window(item)
          WHERE (window.item ->> 'weekday')::integer = extract(isodow FROM
              $2::timestamptz AT TIME ZONE lead.timezone)::integer
            AND (window.item ->> 'startMinute')::integer <=
              extract(hour FROM $2::timestamptz AT TIME ZONE lead.timezone)::integer * 60 +
              extract(minute FROM $2::timestamptz AT TIME ZONE lead.timezone)::integer
            AND (window.item ->> 'endMinute')::integer >
              extract(hour FROM $2::timestamptz AT TIME ZONE lead.timezone)::integer * 60 +
              extract(minute FROM $2::timestamptz AT TIME ZONE lead.timezone)::integer)
      ORDER BY task.scheduled_at, task.id LIMIT $3
      FOR UPDATE OF task SKIP LOCKED
    `, [iso(now), limit]);
    return result.rows.map(mapTask);
  }

  async capacity(task: EnterpriseMarketingTaskRecord, tenantLimit: number) {
    const campaign = await this.session.query<{ concurrency_limit: number | string;
      status: string }>(`
      SELECT concurrency_limit, status FROM enterprise.marketing_campaigns
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE
    `, [uuid(task.campaignId)]);
    const row = campaign.rows[0];
    if (!row || !["scheduled", "running"].includes(row.status)) return false;
    const counts = await this.session.query<{ tenant_count: string;
      campaign_count: string }>(`
      SELECT count(*) FILTER (WHERE status IN ('dispatching', 'dispatched', 'answered'))::text
          AS tenant_count,
        count(*) FILTER (WHERE campaign_id = $2 AND status IN
          ('dispatching', 'dispatched', 'answered'))::text AS campaign_count
      FROM enterprise.marketing_call_tasks WHERE tenant_id = $1
    `, [uuid(task.campaignId)]);
    return nonnegative(counts.rows[0]?.tenant_count) < tenantLimit &&
      nonnegative(counts.rows[0]?.campaign_count) < positive(row.concurrency_limit);
  }

  async claim(input: { task: EnterpriseMarketingTaskRecord; schedulerId: string;
    tokenHash: string; usageHoldId: string; leaseExpiresAt: string; now: string }) {
    const result = await this.session.query<TaskRow>(`
      UPDATE enterprise.marketing_call_tasks
      SET status = 'dispatching', outcome_code = NULL, claimed_at = $3,
        claim_owner = $4, claim_token_hash = $5, lease_expires_at = $6,
        usage_hold_id = $7, dispatch_generation = dispatch_generation + 1,
        updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $8
        AND status IN ('scheduled', 'retry') AND scheduled_at <= $3
      RETURNING *
    `, [uuid(input.task.id), iso(input.now), code(input.schedulerId, 128),
      hash(input.tokenHash), iso(input.leaseExpiresAt), uuid(input.usageHoldId),
      input.task.version]);
    if (!result.rows[0]) return null;
    await this.session.query(`
      UPDATE enterprise.marketing_campaigns
      SET status = 'running', updated_at = GREATEST($3::timestamptz,
        updated_at + interval '1 millisecond'), version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'scheduled'
      RETURNING id
    `, [uuid(input.task.campaignId), iso(input.now)]);
    return mapTask(result.rows[0]);
  }
}

interface StatusRow extends Record<string, unknown> { total: string; pending: string;
  scheduled: string; dispatching: string; dispatched: string; answered: string;
  retry: string; completed: string; failed: string; cancelled: string;
  next_due_at: string | Date | null; tenant_active_claims: string; }
interface RouteRow extends Record<string, unknown> { id: string; home_region: string;
  cell_id: string | null; version: number | string; }
interface TaskRow extends Record<string, unknown> { id: string; tenant_id: string;
  campaign_id: string; lead_id: string; scheduled_at: string | Date; status: string;
  attempt: number | string; idempotency_key: string; outcome_code: string | null;
  claimed_at: string | Date | null; approval_snapshot_id: string;
  country_policy_version_id: string; generation_hash: string; generated_by: string;
  generated_at: string | Date; usage_hold_id: string | null; claim_owner: string | null;
  claim_token_hash: string | null; lease_expires_at: string | Date | null;
  dispatch_generation: number | string; created_at: string | Date;
  updated_at: string | Date; version: number | string; }
function taskCounts(row?: StatusRow): EnterpriseMarketingTaskCounts { return {
  total: nonnegative(row?.total), pending: nonnegative(row?.pending),
  scheduled: nonnegative(row?.scheduled),
  dispatching: nonnegative(row?.dispatching), dispatched: nonnegative(row?.dispatched),
  answered: nonnegative(row?.answered), retry: nonnegative(row?.retry),
  completed: nonnegative(row?.completed), failed: nonnegative(row?.failed),
  cancelled: nonnegative(row?.cancelled) }; }
function mapTask(row: TaskRow): EnterpriseMarketingTaskRecord {
  if (!taskStatus(row.status)) throw new Error("Invalid marketing task status");
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id), campaignId: uuid(row.campaign_id),
    leadId: uuid(row.lead_id), scheduledAt: iso(row.scheduled_at), status: row.status,
    attempt: positive(row.attempt), idempotencyKey: code(row.idempotency_key, 160),
    ...(row.outcome_code ? { outcomeCode: code(row.outcome_code, 80) } : {}),
    ...(row.claimed_at ? { claimedAt: iso(row.claimed_at) } : {}),
    approvalSnapshotId: uuid(row.approval_snapshot_id),
    countryPolicyVersionId: uuid(row.country_policy_version_id),
    generationHash: hash(row.generation_hash), generatedBy: String(row.generated_by),
    generatedAt: iso(row.generated_at), ...(row.usage_hold_id
      ? { usageHoldId: uuid(row.usage_hold_id) } : {}),
    ...(row.claim_owner ? { claimOwner: code(row.claim_owner, 128) } : {}),
    ...(row.claim_token_hash ? { claimTokenHash: hash(row.claim_token_hash) } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: iso(row.lease_expires_at) } : {}),
    dispatchGeneration: nonnegative(row.dispatch_generation), createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), version: positive(row.version) };
}
function taskStatus(value: unknown): value is EnterpriseMarketingTaskRecord["status"] { return typeof value === "string" && ["pending", "scheduled", "dispatching", "dispatched", "answered", "retry", "completed", "failed", "cancelled"].includes(value); }
function uuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid scheduler UUID"); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid scheduler hash"); return value; }
function code(value: unknown, max: number) { if (typeof value !== "string" || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error("Invalid scheduler code"); return value; }
function iso(value: unknown) { const result = value instanceof Date ? value.toISOString() : value; if (typeof result !== "string" || new Date(result).toISOString() !== result) throw new Error("Invalid scheduler timestamp"); return result; }
function positive(value: unknown) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error("Invalid scheduler number"); return result; }
function nonnegative(value: unknown) { const result = Number(value ?? 0); if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid scheduler count"); return result; }
