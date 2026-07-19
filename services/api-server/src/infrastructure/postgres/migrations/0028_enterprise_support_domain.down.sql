DROP TRIGGER IF EXISTS tool_executions_guard ON enterprise.tool_executions;
DROP FUNCTION IF EXISTS enterprise.guard_tool_execution_mutation();
DROP TRIGGER IF EXISTS support_cases_guard ON enterprise.support_cases;
DROP FUNCTION IF EXISTS enterprise.guard_support_case_mutation();
DROP TRIGGER IF EXISTS support_sessions_guard ON enterprise.support_sessions;
DROP FUNCTION IF EXISTS enterprise.guard_support_session_mutation();

ALTER TABLE enterprise.tool_executions
  DROP CONSTRAINT IF EXISTS tool_executions_session_customer_fk,
  DROP CONSTRAINT IF EXISTS tool_executions_confirmation_shape_check,
  DROP CONSTRAINT IF EXISTS tool_executions_state_shape_check,
  DROP CONSTRAINT IF EXISTS tool_executions_time_check,
  DROP CONSTRAINT IF EXISTS tool_executions_result_check,
  DROP CONSTRAINT IF EXISTS tool_executions_idempotency_check,
  DROP CONSTRAINT IF EXISTS tool_executions_status_check,
  DROP CONSTRAINT IF EXISTS tool_executions_confirmation_check,
  DROP CONSTRAINT IF EXISTS tool_executions_hash_check,
  DROP CONSTRAINT IF EXISTS tool_executions_risk_check,
  DROP CONSTRAINT IF EXISTS tool_executions_name_check,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS customer_id;

ALTER TABLE enterprise.support_cases
  DROP CONSTRAINT IF EXISTS support_cases_session_customer_fk,
  DROP CONSTRAINT IF EXISTS support_cases_state_shape_check,
  DROP CONSTRAINT IF EXISTS support_cases_time_check,
  DROP CONSTRAINT IF EXISTS support_cases_external_check,
  DROP CONSTRAINT IF EXISTS support_cases_resolution_check,
  DROP CONSTRAINT IF EXISTS support_cases_summary_check,
  DROP CONSTRAINT IF EXISTS support_cases_status_check,
  DROP CONSTRAINT IF EXISTS support_cases_subject_check,
  DROP COLUMN IF EXISTS closed_at,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at;

DROP INDEX IF EXISTS enterprise.support_sessions_recovery_idx;
DROP INDEX IF EXISTS enterprise.support_sessions_tenant_creation_unique_idx;
ALTER TABLE enterprise.support_sessions
  DROP CONSTRAINT IF EXISTS support_sessions_queue_fk,
  DROP CONSTRAINT IF EXISTS support_sessions_tenant_session_customer_unique,
  DROP CONSTRAINT IF EXISTS support_sessions_state_shape_check,
  DROP CONSTRAINT IF EXISTS support_sessions_time_check,
  DROP CONSTRAINT IF EXISTS support_sessions_assignment_time_check,
  DROP CONSTRAINT IF EXISTS support_sessions_legacy_binding_check,
  DROP CONSTRAINT IF EXISTS support_sessions_failure_check,
  DROP CONSTRAINT IF EXISTS support_sessions_intent_check,
  DROP CONSTRAINT IF EXISTS support_sessions_priority_check,
  DROP CONSTRAINT IF EXISTS support_sessions_status_check,
  DROP CONSTRAINT IF EXISTS support_sessions_request_hash_check,
  DROP CONSTRAINT IF EXISTS support_sessions_creation_key_check,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS failure_code,
  DROP COLUMN IF EXISTS ended_at,
  DROP COLUMN IF EXISTS assigned_at,
  DROP COLUMN IF EXISTS handoff_requested_at,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS queued_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS creation_request_hash,
  DROP COLUMN IF EXISTS creation_key;

ALTER TABLE enterprise.customer_profiles
  DROP CONSTRAINT IF EXISTS customer_profiles_time_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_consent_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_attributes_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_locale_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_name_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_phone_hash_check,
  DROP CONSTRAINT IF EXISTS customer_profiles_external_check,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at;

ALTER TABLE enterprise.support_channels
  DROP CONSTRAINT IF EXISTS support_channels_time_check,
  DROP CONSTRAINT IF EXISTS support_channels_status_check,
  DROP CONSTRAINT IF EXISTS support_channels_config_ref_check,
  DROP CONSTRAINT IF EXISTS support_channels_provider_check,
  DROP CONSTRAINT IF EXISTS support_channels_type_check,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at;

DROP POLICY IF EXISTS support_queues_tenant_isolation ON enterprise.support_queues;
DROP TABLE IF EXISTS enterprise.support_queues;
