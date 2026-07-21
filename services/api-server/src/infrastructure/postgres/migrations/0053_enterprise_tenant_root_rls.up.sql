CREATE POLICY tenants_tenant_isolation ON enterprise.tenants
  USING (id = enterprise.current_tenant_id())
  WITH CHECK (id = enterprise.current_tenant_id());

ALTER TABLE enterprise.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.tenants FORCE ROW LEVEL SECURITY;
