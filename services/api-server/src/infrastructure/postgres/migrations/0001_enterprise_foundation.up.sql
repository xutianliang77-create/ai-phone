CREATE SCHEMA IF NOT EXISTS enterprise;

CREATE TABLE enterprise.tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'deletion_requested', 'deleted')),
  home_region text NOT NULL CHECK (length(home_region) BETWEEN 2 AND 64),
  cell_id text,
  plan_code text NOT NULL,
  trial_ends_at timestamptz,
  billing_customer_ref text,
  data_retention_days integer NOT NULL CHECK (data_retention_days > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1)
);
CREATE INDEX tenants_status_updated_idx
  ON enterprise.tenants (status, updated_at, id);

CREATE TABLE enterprise.members (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN (
    'owner', 'admin', 'marketing_manager', 'marketing_member',
    'support_manager', 'support_agent', 'meeting_host', 'member', 'auditor'
  )),
  status text NOT NULL CHECK (status IN ('invited', 'active', 'suspended')),
  joined_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX members_tenant_status_idx
  ON enterprise.members (tenant_id, status, updated_at, id);

CREATE TABLE enterprise.api_credentials (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  name text NOT NULL,
  secret_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
CREATE INDEX api_credentials_tenant_active_idx
  ON enterprise.api_credentials (tenant_id, revoked_at, expires_at, id);

CREATE TABLE enterprise.entitlements (
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  entitlement_key text NOT NULL,
  limit_value bigint,
  enabled boolean NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  source_plan_version text NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  PRIMARY KEY (tenant_id, entitlement_key)
);

CREATE TABLE enterprise.subscriptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  plan_code text NOT NULL,
  status text NOT NULL,
  seats integer NOT NULL CHECK (seats >= 0),
  billing_cycle text NOT NULL,
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  CHECK (current_period_end > current_period_start)
);
CREATE INDEX subscriptions_tenant_status_idx
  ON enterprise.subscriptions (tenant_id, status, current_period_end, id);

CREATE TABLE enterprise.knowledge_sources (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  name text NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id)
);
CREATE INDEX knowledge_sources_tenant_status_idx
  ON enterprise.knowledge_sources (tenant_id, status, updated_at, id);

CREATE TABLE enterprise.knowledge_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  source_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL CHECK (status IN ('draft', 'processing', 'review', 'published', 'expired', 'failed')),
  object_id uuid,
  content_hash text,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source_id, revision),
  FOREIGN KEY (tenant_id, source_id)
    REFERENCES enterprise.knowledge_sources (tenant_id, id)
);
CREATE INDEX knowledge_versions_tenant_status_idx
  ON enterprise.knowledge_versions (tenant_id, status, created_at, id);

CREATE TABLE enterprise.term_packs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  name text NOT NULL,
  locale text NOT NULL,
  status text NOT NULL,
  terms jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id)
);
CREATE INDEX term_packs_tenant_status_idx
  ON enterprise.term_packs (tenant_id, status, updated_at, id);

CREATE TABLE enterprise.policy_decisions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  result text NOT NULL CHECK (result IN ('allow', 'deny')),
  reason_code text NOT NULL,
  policy_version text NOT NULL,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id)
);
CREATE INDEX policy_decisions_tenant_created_idx
  ON enterprise.policy_decisions (tenant_id, created_at, id);

CREATE TABLE enterprise.audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  result text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id)
);
CREATE INDEX audit_events_tenant_created_idx
  ON enterprise.audit_events (tenant_id, created_at DESC, id DESC);

CREATE TABLE enterprise.usage_ledger (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  category text NOT NULL,
  amount bigint NOT NULL,
  unit text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX usage_ledger_tenant_occurred_idx
  ON enterprise.usage_ledger (tenant_id, occurred_at, id);

CREATE TABLE enterprise.idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  actor_id uuid NOT NULL,
  route text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL,
  response_code integer,
  response_body_ref text,
  resource_id uuid,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, actor_id, route, idempotency_key)
);
CREATE INDEX idempotency_keys_tenant_expiry_idx
  ON enterprise.idempotency_keys (tenant_id, expires_at, idempotency_key);

CREATE TABLE enterprise.inbox_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  source text NOT NULL,
  source_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, source, source_event_id)
);
CREATE INDEX inbox_events_tenant_pending_idx
  ON enterprise.inbox_events (tenant_id, processed_at, received_at, id);

CREATE TABLE enterprise.outbox_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX outbox_events_tenant_pending_idx
  ON enterprise.outbox_events (tenant_id, published_at, available_at, id);
