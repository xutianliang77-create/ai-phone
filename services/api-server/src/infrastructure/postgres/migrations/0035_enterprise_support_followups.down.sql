DROP TRIGGER IF EXISTS support_followup_commands_insert_guard
  ON enterprise.support_followup_commands;
DROP FUNCTION IF EXISTS enterprise.guard_support_followup_command_insert();
DROP TRIGGER IF EXISTS support_followup_commands_guard
  ON enterprise.support_followup_commands;
DROP FUNCTION IF EXISTS enterprise.guard_support_followup_command_mutation();
DROP TRIGGER IF EXISTS support_callbacks_guard
  ON enterprise.support_callbacks;
DROP FUNCTION IF EXISTS enterprise.guard_support_callback_mutation();
DROP TABLE IF EXISTS enterprise.support_followup_commands;
DROP TABLE IF EXISTS enterprise.support_callbacks;
ALTER TABLE enterprise.support_cases
  DROP CONSTRAINT IF EXISTS support_cases_followup_binding_key;
ALTER TABLE enterprise.support_agent_claims
  DROP CONSTRAINT IF EXISTS support_agent_claims_followup_binding_key;
