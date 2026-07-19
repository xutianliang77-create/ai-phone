import {
  EnterpriseEntitlementResolutionPostgresRepository,
} from "./enterprise-postgres-entitlement-resolution.js";
import { code, iso, uuid, type BindingRow, type TaskRow } from
  "./enterprise-postgres-marketing-pstn-record.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

interface BindingInput {
  bindingId: string;
  sessionId: string;
  task: TaskRow;
  homeRegion: string;
  cellId: string;
  routeEpoch: number;
  generation: number;
  now: string;
  policyVersion: string;
}

export async function marketingPstnSafetyFenceIsCurrent(
  session: EnterpriseTenantPostgresSession,
  task: TaskRow,
  now: string,
) {
  const result = await session.query<{ allowed: boolean }>(`
    SELECT enterprise.marketing_campaign_approval_is_current(
        task.campaign_id, task.approval_snapshot_id)
      AND campaign.status IN ('scheduled', 'running')
      AND lead.status = 'active'
      AND policy.effective_from <= $3 AND policy.expires_at > $3
      AND EXISTS (SELECT 1 FROM enterprise.marketing_campaign_leads link
        WHERE link.tenant_id = task.tenant_id AND link.campaign_id = task.campaign_id
          AND link.lead_id = task.lead_id AND link.status = 'active')
      AND EXISTS (SELECT 1 FROM enterprise.contact_consents consent
        WHERE consent.tenant_id = task.tenant_id
          AND consent.campaign_id = task.campaign_id AND consent.lead_id = task.lead_id
          AND consent.purpose = 'automated_marketing_call'
          AND consent.granted_at <= task.scheduled_at AND consent.revoked_at IS NULL
          AND (consent.expires_at IS NULL OR consent.expires_at > $3))
      AND NOT EXISTS (SELECT 1 FROM enterprise.suppression_entries suppression
        WHERE suppression.tenant_id = task.tenant_id
          AND suppression.phone_hash = lead.phone_hash
          AND suppression.scope IN ('tenant', 'global'))
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(policy.calling_windows) window(item)
        WHERE (window.item ->> 'weekday')::integer = extract(isodow FROM
            $3::timestamptz AT TIME ZONE lead.timezone)::integer
          AND (window.item ->> 'startMinute')::integer <=
            extract(hour FROM $3::timestamptz AT TIME ZONE lead.timezone)::integer * 60 +
            extract(minute FROM $3::timestamptz AT TIME ZONE lead.timezone)::integer
          AND (window.item ->> 'endMinute')::integer >
            extract(hour FROM $3::timestamptz AT TIME ZONE lead.timezone)::integer * 60 +
            extract(minute FROM $3::timestamptz AT TIME ZONE lead.timezone)::integer)
      AS allowed
    FROM enterprise.marketing_call_tasks task
    JOIN enterprise.marketing_campaigns campaign ON campaign.tenant_id = task.tenant_id
      AND campaign.id = task.campaign_id
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = task.tenant_id
      AND lead.id = task.lead_id
    JOIN enterprise.marketing_country_policy_versions policy
      ON policy.tenant_id = task.tenant_id AND policy.id = task.country_policy_version_id
    WHERE task.tenant_id = $1 AND task.id = $2
  `, [uuid(task.id), iso(now)]);
  return result.rows[0]?.allowed === true;
}

export async function ensureMarketingPstnBinding(
  session: EnterpriseTenantPostgresSession,
  input: BindingInput,
) {
  const existing = await session.query<BindingRow>(`
    SELECT id, communication_session_id, status, generation,
      last_event_sequence, version, route_epoch
    FROM enterprise.communication_session_bindings
    WHERE tenant_id = $1 AND marketing_call_task_id = $2 FOR UPDATE
  `, [uuid(input.task.id)]);
  if (existing.rows[0]) return updateExistingBinding(session, existing.rows[0], input);

  const entitlement = await new EnterpriseEntitlementResolutionPostgresRepository(
    session,
  ).current(new Date(input.now));
  if (!entitlement) return null;
  await session.queryCommunicationMutation(`
    INSERT INTO ai_phone.communication_sessions(scope_type, scope_id, id,
      user_id, mode, status, consumed_seconds, version, home_region,
      home_cell_id, routing_generation, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'business', 'created', 0, 1, $5, $6, $7, $8, $8)
  `, [input.sessionId, session.context.actorUserId,
    code(input.homeRegion, 64), code(input.cellId, 64), input.routeEpoch, iso(input.now)]);
  const inserted = await session.query<{ id: string }>(`
    INSERT INTO enterprise.communication_session_bindings(tenant_id, id,
      communication_session_id, kind, marketing_call_task_id, status,
      home_region, cell_id, route_epoch, policy_version, entitlement_version,
      trace_id, generation, last_event_sequence, started_at, updated_at, version)
    VALUES ($1, $2, $3, 'marketing', $4, 'dispatching', $5, $6, $7, $8,
      $9, $10, $11, 1, $12, $12, 1)
    RETURNING id
  `, [uuid(input.bindingId), input.sessionId, uuid(input.task.id),
    code(input.homeRegion, 64), code(input.cellId, 64), input.routeEpoch,
    input.policyVersion, entitlement.entitlement.entitlementVersion,
    session.context.traceId, input.generation, iso(input.now)]);
  return inserted.rows[0]?.id ?? null;
}

async function updateExistingBinding(session: EnterpriseTenantPostgresSession,
  row: BindingRow, input: BindingInput) {
  if (row.communication_session_id !== input.sessionId || row.status !== "dispatching" ||
    Number(row.route_epoch) !== input.routeEpoch ||
    Number(row.generation) > input.generation) return null;
  if (Number(row.generation) === input.generation) return row.id;
  const updated = await session.query<{ id: string }>(`
    UPDATE enterprise.communication_session_bindings
    SET generation = $3, last_event_sequence = 1, last_event_at = $4,
      updated_at = $4, version = version + 1
    WHERE tenant_id = $1 AND id = $2 AND version = $5
    RETURNING id
  `, [uuid(row.id), input.generation, iso(input.now), Number(row.version)]);
  return updated.rows[0]?.id ?? null;
}
