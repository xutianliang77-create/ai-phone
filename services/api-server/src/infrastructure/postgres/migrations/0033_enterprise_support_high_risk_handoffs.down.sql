DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM enterprise.support_high_risk_handoff_requests
  ) THEN
    RAISE EXCEPTION 'cannot roll back enterprise high risk handoff evidence';
  END IF;
END;
$$;

DROP POLICY IF EXISTS tenant_isolation
  ON enterprise.support_high_risk_handoff_requests;
DROP TRIGGER IF EXISTS support_high_risk_handoffs_mutation_guard
  ON enterprise.support_high_risk_handoff_requests;
DROP FUNCTION IF EXISTS enterprise.guard_support_high_risk_handoff_mutation();
DROP TRIGGER IF EXISTS support_high_risk_handoffs_insert_guard
  ON enterprise.support_high_risk_handoff_requests;
DROP FUNCTION IF EXISTS enterprise.guard_support_high_risk_handoff_insert();
DROP TABLE IF EXISTS enterprise.support_high_risk_handoff_requests;
