DROP POLICY IF EXISTS marketing_crm_syncs_tenant_isolation
  ON enterprise.marketing_crm_syncs;
DROP TRIGGER IF EXISTS marketing_crm_syncs_guard
  ON enterprise.marketing_crm_syncs;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_crm_sync_mutation();
DROP TABLE IF EXISTS enterprise.marketing_crm_syncs;
