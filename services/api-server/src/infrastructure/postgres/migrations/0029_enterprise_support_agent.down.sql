DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['support_agent_turns', 'support_agent_runs']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON enterprise.%I', table_name);
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS support_agent_turns_guard ON enterprise.support_agent_turns;
DROP FUNCTION IF EXISTS enterprise.guard_support_agent_turn_mutation();
DROP TRIGGER IF EXISTS support_agent_runs_guard ON enterprise.support_agent_runs;
DROP FUNCTION IF EXISTS enterprise.guard_support_agent_run_mutation();
DROP TABLE IF EXISTS enterprise.support_agent_turns;
DROP TABLE IF EXISTS enterprise.support_agent_runs;
