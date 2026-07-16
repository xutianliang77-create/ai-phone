CREATE OR REPLACE FUNCTION enterprise.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE TABLE enterprise.user_tenant_directory (
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  member_status text NOT NULL CHECK (
    member_status IN ('invited', 'active', 'suspended')
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, tenant_id),
  UNIQUE (tenant_id, member_id),
  FOREIGN KEY (tenant_id, member_id)
    REFERENCES enterprise.members (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX user_tenant_directory_tenant_member_idx
  ON enterprise.user_tenant_directory (tenant_id, member_id, updated_at);

LOCK TABLE enterprise.members IN ACCESS EXCLUSIVE MODE;
ALTER TABLE enterprise.members DISABLE ROW LEVEL SECURITY;

INSERT INTO enterprise.user_tenant_directory(
  user_id, tenant_id, member_id, member_status, created_at, updated_at
)
SELECT user_id, tenant_id, id, status, created_at, updated_at
FROM enterprise.members;

ALTER TABLE enterprise.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.members FORCE ROW LEVEL SECURITY;

ALTER TABLE enterprise.user_tenant_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.user_tenant_directory FORCE ROW LEVEL SECURITY;

CREATE POLICY user_tenant_directory_self_read
  ON enterprise.user_tenant_directory
  FOR SELECT
  USING (user_id = enterprise.current_user_id());

CREATE POLICY user_tenant_directory_tenant_read
  ON enterprise.user_tenant_directory
  FOR SELECT
  USING (tenant_id = enterprise.current_tenant_id());

CREATE POLICY user_tenant_directory_tenant_insert
  ON enterprise.user_tenant_directory
  FOR INSERT
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE POLICY user_tenant_directory_tenant_update
  ON enterprise.user_tenant_directory
  FOR UPDATE
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());

CREATE POLICY user_tenant_directory_tenant_delete
  ON enterprise.user_tenant_directory
  FOR DELETE
  USING (tenant_id = enterprise.current_tenant_id());
