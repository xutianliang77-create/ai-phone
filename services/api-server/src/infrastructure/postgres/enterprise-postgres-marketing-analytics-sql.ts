export const analyticsCountsSql = `SELECT
  (SELECT count(DISTINCT link.lead_id) FROM enterprise.marketing_campaign_leads link
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = link.tenant_id
      AND lead.id = link.lead_id
    WHERE link.tenant_id = $1 AND link.campaign_id = $2
      AND link.status = 'active' AND lead.status = 'active')::text AS active_leads,
  (SELECT count(*) FROM enterprise.marketing_call_tasks task
    WHERE task.tenant_id = $1 AND task.campaign_id = $2)::text AS scheduled_tasks,
  (SELECT count(*) FROM enterprise.marketing_pstn_dispatches dispatch
    WHERE dispatch.tenant_id = $1 AND dispatch.campaign_id = $2
      AND dispatch.accepted_at IS NOT NULL)::text AS provider_accepted,
  (SELECT count(*) FROM enterprise.marketing_pstn_dispatches dispatch
    WHERE dispatch.tenant_id = $1 AND dispatch.campaign_id = $2
      AND dispatch.answered_at IS NOT NULL)::text AS answered_calls,
  (SELECT count(*) FROM enterprise.marketing_outcomes outcome
    WHERE outcome.tenant_id = $1 AND outcome.campaign_id = $2
      AND outcome.evidence_status = 'verified')::text AS finalized_outcomes,
  (SELECT count(*) FROM enterprise.marketing_outcomes outcome
    WHERE outcome.tenant_id = $1 AND outcome.campaign_id = $2
      AND outcome.evidence_status = 'verified'
      AND outcome.disposition IN ('potential_lead', 'appointment_requested'))::text
    AS positive_interest_outcomes,
  (SELECT count(*) FROM enterprise.marketing_next_actions action
    WHERE action.tenant_id = $1 AND action.campaign_id = $2
      AND action.status = 'requested')::text AS next_actions_requested,
  (SELECT count(*) FROM enterprise.marketing_crm_syncs sync
    WHERE sync.tenant_id = $1 AND sync.campaign_id = $2
      AND sync.status = 'synced')::text AS crm_reconciled,
  (SELECT count(*) FROM enterprise.suppression_entries suppression
    WHERE suppression.tenant_id = $1 AND suppression.origin_campaign_id = $2
      AND suppression.source = 'complaint')::text AS explicit_complaints,
  (SELECT count(*) FROM enterprise.suppression_entries suppression
    WHERE suppression.tenant_id = $1 AND suppression.origin_campaign_id = $2
      AND suppression.source = 'complaint' AND EXISTS (
        SELECT 1 FROM enterprise.marketing_pstn_dispatches dispatch
        WHERE dispatch.tenant_id = suppression.tenant_id
          AND dispatch.campaign_id = suppression.origin_campaign_id
          AND dispatch.communication_session_id = suppression.source_reference
      ))::text AS session_attributed_complaints`;

export const analyticsDistributionsSql = `
  SELECT 'disposition'::text AS dimension, outcome.disposition AS value,
    count(*)::text AS total
  FROM enterprise.marketing_outcomes outcome
  WHERE outcome.tenant_id = $1 AND outcome.campaign_id = $2
    AND outcome.evidence_status = 'verified'
  GROUP BY outcome.disposition
  UNION ALL
  SELECT 'intent'::text AS dimension, outcome.intent_level AS value,
    count(*)::text AS total
  FROM enterprise.marketing_outcomes outcome
  WHERE outcome.tenant_id = $1 AND outcome.campaign_id = $2
    AND outcome.evidence_status = 'verified'
  GROUP BY outcome.intent_level`;

export const analyticsCountriesSql = `WITH countries AS (
  SELECT unnest(campaign.country_codes) AS country_code
  FROM enterprise.marketing_campaigns campaign
  WHERE campaign.tenant_id = $1 AND campaign.id = $2
  UNION
  SELECT lead.country_code
  FROM enterprise.marketing_campaign_leads link
  JOIN enterprise.marketing_leads lead ON lead.tenant_id = link.tenant_id
    AND lead.id = link.lead_id
  WHERE link.tenant_id = $1 AND link.campaign_id = $2
)
SELECT country.country_code,
  (SELECT count(DISTINCT link.lead_id) FROM enterprise.marketing_campaign_leads link
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = link.tenant_id
      AND lead.id = link.lead_id
    WHERE link.tenant_id = $1 AND link.campaign_id = $2 AND link.status = 'active'
      AND lead.status = 'active' AND lead.country_code = country.country_code)::text
    AS active_leads,
  (SELECT count(*) FROM enterprise.marketing_call_tasks task
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = task.tenant_id
      AND lead.id = task.lead_id
    WHERE task.tenant_id = $1 AND task.campaign_id = $2
      AND lead.country_code = country.country_code)::text AS scheduled_tasks,
  (SELECT count(*) FROM enterprise.marketing_pstn_dispatches dispatch
    JOIN enterprise.marketing_call_tasks task ON task.tenant_id = dispatch.tenant_id
      AND task.id = dispatch.task_id
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = task.tenant_id
      AND lead.id = task.lead_id
    WHERE dispatch.tenant_id = $1 AND dispatch.campaign_id = $2
      AND lead.country_code = country.country_code
      AND dispatch.accepted_at IS NOT NULL)::text AS provider_accepted,
  (SELECT count(*) FROM enterprise.marketing_pstn_dispatches dispatch
    JOIN enterprise.marketing_call_tasks task ON task.tenant_id = dispatch.tenant_id
      AND task.id = dispatch.task_id
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = task.tenant_id
      AND lead.id = task.lead_id
    WHERE dispatch.tenant_id = $1 AND dispatch.campaign_id = $2
      AND lead.country_code = country.country_code
      AND dispatch.answered_at IS NOT NULL)::text AS answered_calls,
  (SELECT count(*) FROM enterprise.marketing_outcomes outcome
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = outcome.tenant_id
      AND lead.id = outcome.lead_id
    WHERE outcome.tenant_id = $1 AND outcome.campaign_id = $2
      AND lead.country_code = country.country_code
      AND outcome.evidence_status = 'verified')::text AS finalized_outcomes,
  (SELECT count(*) FROM enterprise.marketing_outcomes outcome
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = outcome.tenant_id
      AND lead.id = outcome.lead_id
    WHERE outcome.tenant_id = $1 AND outcome.campaign_id = $2
      AND lead.country_code = country.country_code
      AND outcome.evidence_status = 'verified'
      AND outcome.disposition IN ('potential_lead', 'appointment_requested'))::text
    AS positive_interest_outcomes,
  (SELECT count(*) FROM enterprise.marketing_next_actions action
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = action.tenant_id
      AND lead.id = action.lead_id
    WHERE action.tenant_id = $1 AND action.campaign_id = $2
      AND lead.country_code = country.country_code
      AND action.status = 'requested')::text AS next_actions_requested,
  (SELECT count(*) FROM enterprise.marketing_crm_syncs sync
    JOIN enterprise.marketing_outcomes outcome ON outcome.tenant_id = sync.tenant_id
      AND outcome.id = sync.outcome_id
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = outcome.tenant_id
      AND lead.id = outcome.lead_id
    WHERE sync.tenant_id = $1 AND sync.campaign_id = $2
      AND lead.country_code = country.country_code
      AND sync.status = 'synced')::text AS crm_reconciled,
  (SELECT count(*) FROM enterprise.suppression_entries suppression
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = suppression.tenant_id
      AND lead.id = suppression.lead_id
    WHERE suppression.tenant_id = $1 AND suppression.origin_campaign_id = $2
      AND lead.country_code = country.country_code
      AND suppression.source = 'complaint')::text AS explicit_complaints,
  (SELECT count(*) FROM enterprise.suppression_entries suppression
    JOIN enterprise.marketing_leads lead ON lead.tenant_id = suppression.tenant_id
      AND lead.id = suppression.lead_id
    WHERE suppression.tenant_id = $1 AND suppression.origin_campaign_id = $2
      AND lead.country_code = country.country_code AND suppression.source = 'complaint'
      AND EXISTS (SELECT 1 FROM enterprise.marketing_pstn_dispatches dispatch
        WHERE dispatch.tenant_id = suppression.tenant_id
          AND dispatch.campaign_id = suppression.origin_campaign_id
          AND dispatch.communication_session_id = suppression.source_reference))::text
    AS session_attributed_complaints
FROM countries country ORDER BY country.country_code`;

export const analyticsVersionsSql = `SELECT run.profile_version,
  run.term_pack_version_id, run.script_template_version_id,
  run.provider_fingerprint AS agent_provider_fingerprint,
  dispatch.provider AS pstn_provider,
  dispatch.provider_fingerprint AS pstn_provider_fingerprint,
  count(*)::text AS run_count,
  (count(*) FILTER (WHERE dispatch.answered_at IS NOT NULL))::text AS answered_calls,
  (count(*) FILTER (WHERE outcome.id IS NOT NULL))::text AS finalized_outcomes,
  (count(*) FILTER (WHERE outcome.disposition IN
    ('potential_lead', 'appointment_requested')))::text AS positive_interest_outcomes,
  (count(*) FILTER (WHERE sync.status = 'synced'))::text AS crm_reconciled,
  (count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM enterprise.suppression_entries suppression
    WHERE suppression.tenant_id = run.tenant_id
      AND suppression.origin_campaign_id = run.campaign_id
      AND suppression.lead_id = run.lead_id AND suppression.source = 'complaint'
      AND suppression.source_reference = run.communication_session_id
  )))::text AS session_attributed_complaints
FROM enterprise.marketing_agent_runs run
JOIN enterprise.marketing_pstn_dispatches dispatch
  ON dispatch.tenant_id = run.tenant_id AND dispatch.id = run.dispatch_id
LEFT JOIN enterprise.marketing_outcomes outcome
  ON outcome.tenant_id = run.tenant_id AND outcome.task_id = run.task_id
  AND outcome.evidence_status = 'verified'
LEFT JOIN enterprise.marketing_crm_syncs sync
  ON sync.tenant_id = outcome.tenant_id AND sync.outcome_id = outcome.id
WHERE run.tenant_id = $1 AND run.campaign_id = $2
GROUP BY run.profile_version, run.term_pack_version_id,
  run.script_template_version_id, run.provider_fingerprint,
  dispatch.provider, dispatch.provider_fingerprint
ORDER BY run.profile_version, run.term_pack_version_id,
  run.script_template_version_id, dispatch.provider`;

const usageNetCte = `WITH event_net AS (
  SELECT event.tenant_id, event.hold_id, event.category, event.unit,
    event.amount AS settled_amount, 1::bigint AS event_count,
    COALESCE(sum(adjustment.delta_amount), 0)::bigint AS adjustment_amount,
    (event.amount + COALESCE(sum(adjustment.delta_amount), 0))::bigint AS net_amount
  FROM enterprise.tenant_usage_events event
  LEFT JOIN enterprise.usage_adjustments adjustment
    ON adjustment.tenant_id = event.tenant_id
    AND adjustment.target_ledger_entry_id = event.ledger_entry_id
  WHERE event.tenant_id = $1
  GROUP BY event.tenant_id, event.id, event.hold_id, event.category, event.unit,
    event.amount
)`;

export const analyticsUsageSql = `${usageNetCte}
SELECT usage.category, usage.unit, sum(usage.settled_amount)::text AS settled_amount,
  sum(usage.adjustment_amount)::text AS adjustment_amount,
  sum(usage.net_amount)::text AS net_amount,
  sum(usage.event_count)::text AS event_count
FROM event_net usage
JOIN enterprise.usage_holds hold ON hold.tenant_id = usage.tenant_id
  AND hold.id = usage.hold_id AND hold.source_type = 'marketing_call_task'
JOIN enterprise.marketing_call_tasks task ON task.tenant_id = hold.tenant_id
  AND task.id::text = hold.source_ref
WHERE task.tenant_id = $1 AND task.campaign_id = $2
GROUP BY usage.category, usage.unit ORDER BY usage.category, usage.unit`;

export const analyticsCountryUsageSql = `${usageNetCte}
SELECT lead.country_code, usage.category, usage.unit,
  sum(usage.settled_amount)::text AS settled_amount,
  sum(usage.adjustment_amount)::text AS adjustment_amount,
  sum(usage.net_amount)::text AS net_amount,
  sum(usage.event_count)::text AS event_count
FROM event_net usage
JOIN enterprise.usage_holds hold ON hold.tenant_id = usage.tenant_id
  AND hold.id = usage.hold_id AND hold.source_type = 'marketing_call_task'
JOIN enterprise.marketing_call_tasks task ON task.tenant_id = hold.tenant_id
  AND task.id::text = hold.source_ref
JOIN enterprise.marketing_leads lead ON lead.tenant_id = task.tenant_id
  AND lead.id = task.lead_id
WHERE task.tenant_id = $1 AND task.campaign_id = $2
GROUP BY lead.country_code, usage.category, usage.unit
ORDER BY lead.country_code, usage.category, usage.unit`;

export const analyticsVersionUsageSql = `${usageNetCte}
SELECT run.profile_version, run.term_pack_version_id,
  run.script_template_version_id,
  run.provider_fingerprint AS agent_provider_fingerprint,
  dispatch.provider AS pstn_provider,
  dispatch.provider_fingerprint AS pstn_provider_fingerprint,
  usage.category, usage.unit,
  sum(usage.settled_amount)::text AS settled_amount,
  sum(usage.adjustment_amount)::text AS adjustment_amount,
  sum(usage.net_amount)::text AS net_amount,
  sum(usage.event_count)::text AS event_count
FROM event_net usage
JOIN enterprise.usage_holds hold ON hold.tenant_id = usage.tenant_id
  AND hold.id = usage.hold_id AND hold.source_type = 'marketing_call_task'
JOIN enterprise.marketing_call_tasks task ON task.tenant_id = hold.tenant_id
  AND task.id::text = hold.source_ref
JOIN enterprise.marketing_pstn_dispatches dispatch
  ON dispatch.tenant_id = task.tenant_id AND dispatch.task_id = task.id
  AND dispatch.usage_hold_id = usage.hold_id
JOIN enterprise.marketing_agent_runs run ON run.tenant_id = dispatch.tenant_id
  AND run.dispatch_id = dispatch.id
WHERE task.tenant_id = $1 AND task.campaign_id = $2
GROUP BY run.profile_version, run.term_pack_version_id,
  run.script_template_version_id, run.provider_fingerprint,
  dispatch.provider, dispatch.provider_fingerprint,
  usage.category, usage.unit
ORDER BY run.profile_version, run.term_pack_version_id,
  run.script_template_version_id, dispatch.provider, usage.category`;
