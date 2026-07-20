DROP POLICY IF EXISTS marketing_next_actions_tenant_isolation
  ON enterprise.marketing_next_actions;
DROP TRIGGER IF EXISTS marketing_outcomes_next_action_consistency
  ON enterprise.marketing_outcomes;
DROP FUNCTION IF EXISTS enterprise.validate_marketing_outcome_next_action();
DROP TRIGGER IF EXISTS marketing_next_actions_guard
  ON enterprise.marketing_next_actions;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_next_action();
DROP TABLE IF EXISTS enterprise.marketing_next_actions;

DROP TRIGGER IF EXISTS marketing_outcomes_guard
  ON enterprise.marketing_outcomes;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_outcome();
DROP INDEX IF EXISTS enterprise.marketing_outcomes_campaign_created_idx;
DROP INDEX IF EXISTS enterprise.marketing_outcomes_actor_command_unique_idx;

ALTER TABLE enterprise.marketing_outcomes
  DROP CONSTRAINT IF EXISTS marketing_outcomes_updated_check,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_version_check,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_request_hash_check,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_source_hash_check,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_evidence_hash_check,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_evidence_document_check,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_evidence_status_check,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_agent_run_fk,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_dispatch_fk,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_lead_fk,
  DROP CONSTRAINT IF EXISTS marketing_outcomes_campaign_fk,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS request_hash,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS evidence_status,
  DROP COLUMN IF EXISTS source_hash,
  DROP COLUMN IF EXISTS evidence_hash,
  DROP COLUMN IF EXISTS evidence_document,
  DROP COLUMN IF EXISTS communication_session_id,
  DROP COLUMN IF EXISTS agent_run_id,
  DROP COLUMN IF EXISTS dispatch_id,
  DROP COLUMN IF EXISTS lead_id,
  DROP COLUMN IF EXISTS campaign_id;
