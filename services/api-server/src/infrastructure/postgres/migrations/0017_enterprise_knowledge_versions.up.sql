ALTER TABLE enterprise.knowledge_versions
  ADD COLUMN locale text NOT NULL DEFAULT 'und',
  ADD COLUMN country_code text NOT NULL DEFAULT 'ALL',
  ADD COLUMN product_code text NOT NULL DEFAULT 'all',
  ADD COLUMN effective_from timestamptz,
  ADD COLUMN reviewed_by text,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN published_by text;

ALTER TABLE enterprise.knowledge_versions
  ADD CONSTRAINT knowledge_versions_locale_check
    CHECK (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT knowledge_versions_country_check
    CHECK (country_code = 'ALL' OR country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT knowledge_versions_product_check
    CHECK (product_code ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  ADD CONSTRAINT knowledge_versions_reviewed_by_check
    CHECK (reviewed_by IS NULL OR enterprise.is_account_subject_id(reviewed_by)),
  ADD CONSTRAINT knowledge_versions_published_by_check
    CHECK (published_by IS NULL OR enterprise.is_account_subject_id(published_by));

CREATE UNIQUE INDEX knowledge_sources_tenant_name_active_idx
  ON enterprise.knowledge_sources (tenant_id, lower(name))
  WHERE status <> 'archived';

CREATE INDEX knowledge_versions_retrieval_idx
  ON enterprise.knowledge_versions (
    tenant_id, status, locale, country_code, product_code,
    effective_from, expires_at, source_id, revision DESC
  );

CREATE TABLE enterprise.knowledge_chunks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  knowledge_version_id uuid NOT NULL,
  block_id text NOT NULL
    CHECK (length(btrim(block_id)) BETWEEN 1 AND 160),
  sequence integer NOT NULL CHECK (sequence >= 1),
  content text NOT NULL
    CHECK (length(btrim(content)) BETWEEN 1 AND 12000),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, knowledge_version_id, block_id),
  UNIQUE (tenant_id, knowledge_version_id, sequence),
  FOREIGN KEY (tenant_id, knowledge_version_id)
    REFERENCES enterprise.knowledge_versions (tenant_id, id)
);
CREATE INDEX knowledge_chunks_version_idx
  ON enterprise.knowledge_chunks (
    tenant_id, knowledge_version_id, sequence, id
  );

CREATE OR REPLACE FUNCTION enterprise.guard_knowledge_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'expired') THEN
      RAISE EXCEPTION 'published enterprise knowledge version is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.source_id, NEW.revision, NEW.created_at)
    IS DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.source_id, OLD.revision, OLD.created_at)
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid enterprise knowledge version mutation';
  END IF;
  IF OLD.status IN ('published', 'expired') THEN
    RAISE EXCEPTION 'published enterprise knowledge version is immutable';
  END IF;
  IF NEW.status = 'published' AND (
    OLD.status <> 'review' OR NEW.content_hash IS NULL
    OR NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
    OR NEW.published_by IS NULL OR NEW.published_at IS NULL
    OR NEW.effective_from IS NULL
    OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.effective_from)
    OR NOT EXISTS (
      SELECT 1 FROM enterprise.knowledge_chunks
      WHERE tenant_id = NEW.tenant_id AND knowledge_version_id = NEW.id
    )
  ) THEN
    RAISE EXCEPTION 'enterprise knowledge version is not publishable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_knowledge_version_guard
BEFORE UPDATE OR DELETE ON enterprise.knowledge_versions
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_knowledge_version_mutation();

CREATE OR REPLACE FUNCTION enterprise.guard_knowledge_chunk_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_status text;
DECLARE selected_tenant_id uuid;
DECLARE selected_version_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'enterprise knowledge chunk is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    selected_tenant_id := OLD.tenant_id;
    selected_version_id := OLD.knowledge_version_id;
  ELSE
    selected_tenant_id := NEW.tenant_id;
    selected_version_id := NEW.knowledge_version_id;
  END IF;
  SELECT status INTO version_status
  FROM enterprise.knowledge_versions
  WHERE tenant_id = selected_tenant_id AND id = selected_version_id;
  IF version_status <> 'draft' THEN
    RAISE EXCEPTION 'enterprise knowledge chunks require a draft version';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER enterprise_knowledge_chunk_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.knowledge_chunks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_knowledge_chunk_mutation();

ALTER TABLE enterprise.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.knowledge_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_chunks_tenant_isolation
  ON enterprise.knowledge_chunks
  USING (tenant_id = enterprise.current_tenant_id())
  WITH CHECK (tenant_id = enterprise.current_tenant_id());
