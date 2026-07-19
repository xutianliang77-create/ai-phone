ALTER TABLE enterprise.suppression_entries
  DROP CONSTRAINT suppression_entries_v2_shape_check;
ALTER TABLE enterprise.suppression_entries
  ADD CONSTRAINT suppression_entries_v2_shape_check CHECK (
    lead_id IS NULL OR (
      phone_hash ~ '^[a-f0-9]{64}$' AND scope IN ('tenant', 'global') AND
      char_length(reason) BETWEEN 1 AND 500 AND reason = btrim(reason) AND
      source IN ('manual', 'contact_request', 'consent_withdrawal',
        'complaint', 'global_registry') AND source_reference IS NOT NULL AND
      char_length(source_reference) BETWEEN 1 AND 200 AND source_reference = btrim(source_reference) AND
      created_by IS NOT NULL AND enterprise.is_actor_subject_id(created_by) AND
      updated_at IS NOT NULL AND version = 1 AND creation_key IS NOT NULL AND
      creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' AND
      creation_request_hash ~ '^[a-f0-9]{64}$' AND
      cancelled_task_count IS NOT NULL AND cancelled_task_count >= 0 AND
      ((scope = 'tenant' AND origin_campaign_id IS NOT NULL AND
        enterprise.is_account_subject_id(created_by) AND source <> 'global_registry') OR
       (scope = 'global' AND origin_campaign_id IS NULL AND
        NOT enterprise.is_account_subject_id(created_by) AND source = 'global_registry'))
    )
  ) NOT VALID;

DROP TRIGGER IF EXISTS marketing_agent_turns_guard ON enterprise.marketing_agent_turns;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_agent_turn();
DROP TRIGGER IF EXISTS marketing_call_tasks_agent_dispatch_guard
  ON enterprise.marketing_call_tasks;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_agent_task_dispatch();
DROP TRIGGER IF EXISTS marketing_agent_runs_guard ON enterprise.marketing_agent_runs;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_agent_run();
DROP TRIGGER IF EXISTS marketing_agent_profiles_guard ON enterprise.marketing_agent_profiles;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_agent_profile();
DROP TABLE IF EXISTS enterprise.marketing_agent_turns;
DROP TABLE IF EXISTS enterprise.marketing_agent_runs;
DROP TABLE IF EXISTS enterprise.marketing_agent_profiles;
