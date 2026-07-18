LOCK TABLE enterprise.term_packs IN ACCESS EXCLUSIVE MODE;
ALTER TABLE enterprise.term_packs DISABLE ROW LEVEL SECURITY;

ALTER TABLE enterprise.term_packs
  ADD COLUMN created_by text;
UPDATE enterprise.term_packs
SET status = CASE WHEN status = 'archived' THEN 'archived' ELSE 'active' END;
ALTER TABLE enterprise.term_packs
  ADD CONSTRAINT term_packs_status_check
    CHECK (status IN ('active', 'archived')),
  ADD CONSTRAINT term_packs_created_by_check
    CHECK (created_by IS NULL OR enterprise.is_account_subject_id(created_by));
CREATE UNIQUE INDEX term_packs_tenant_name_active_idx
  ON enterprise.term_packs (tenant_id, lower(name))
  WHERE status = 'active';

CREATE TABLE enterprise.term_pack_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  term_pack_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL
    CHECK (status IN ('draft', 'review', 'published', 'expired', 'failed')),
  source_locale text NOT NULL
    CHECK (source_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  target_locale text NOT NULL
    CHECK (target_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  country_code text NOT NULL
    CHECK (country_code = 'ALL' OR country_code ~ '^[A-Z]{2}$'),
  product_code text NOT NULL
    CHECK (product_code ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  usage_scope text NOT NULL
    CHECK (usage_scope IN ('all', 'marketing', 'support', 'meeting')),
  terms jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(terms) = 'array'),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  effective_from timestamptz,
  reviewed_by text CHECK (
    reviewed_by IS NULL OR enterprise.is_account_subject_id(reviewed_by)
  ),
  reviewed_at timestamptz,
  published_by text CHECK (
    published_by IS NULL OR enterprise.is_account_subject_id(published_by)
  ),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, term_pack_id, revision),
  FOREIGN KEY (tenant_id, term_pack_id)
    REFERENCES enterprise.term_packs (tenant_id, id)
);
CREATE INDEX term_pack_versions_resolution_idx
  ON enterprise.term_pack_versions (
    tenant_id, term_pack_id, status, source_locale, target_locale,
    country_code, product_code, usage_scope, effective_from, revision DESC
  );

INSERT INTO enterprise.term_pack_versions(
  id, tenant_id, term_pack_id, revision, status,
  source_locale, target_locale, country_code, product_code, usage_scope,
  terms, created_at, version
)
SELECT md5('enterprise-term-pack-version:' || id::text)::uuid,
  tenant_id, id, 1, 'draft',
  CASE WHEN locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    THEN locale ELSE 'und' END,
  'und', 'ALL', 'all', 'all',
  CASE WHEN jsonb_typeof(terms) = 'array' THEN terms ELSE '[]'::jsonb END,
  created_at, 1
FROM enterprise.term_packs;

ALTER TABLE enterprise.term_packs
  DROP COLUMN locale,
  DROP COLUMN terms;
ALTER TABLE enterprise.term_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.term_packs FORCE ROW LEVEL SECURITY;

CREATE TABLE enterprise.script_templates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  purpose text NOT NULL
    CHECK (purpose IN ('all', 'marketing', 'support', 'meeting')),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX script_templates_tenant_name_active_idx
  ON enterprise.script_templates (tenant_id, lower(name))
  WHERE status = 'active';

CREATE TABLE enterprise.script_template_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  script_template_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL
    CHECK (status IN ('draft', 'review', 'published', 'expired', 'failed')),
  locale text NOT NULL
    CHECK (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  country_code text NOT NULL
    CHECK (country_code = 'ALL' OR country_code ~ '^[A-Z]{2}$'),
  product_code text NOT NULL
    CHECK (product_code ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  prompt_text text NOT NULL DEFAULT '',
  required_phrases jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(required_phrases) = 'array'),
  prohibited_phrases jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(prohibited_phrases) = 'array'),
  variables jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(variables) = 'array'),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  effective_from timestamptz,
  reviewed_by text CHECK (
    reviewed_by IS NULL OR enterprise.is_account_subject_id(reviewed_by)
  ),
  reviewed_at timestamptz,
  published_by text CHECK (
    published_by IS NULL OR enterprise.is_account_subject_id(published_by)
  ),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, script_template_id, revision),
  FOREIGN KEY (tenant_id, script_template_id)
    REFERENCES enterprise.script_templates (tenant_id, id)
);
CREATE INDEX script_template_versions_resolution_idx
  ON enterprise.script_template_versions (
    tenant_id, script_template_id, status, locale, country_code,
    product_code, effective_from, revision DESC
  );

CREATE OR REPLACE FUNCTION enterprise.guard_term_pack_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'expired') THEN
      RAISE EXCEPTION 'published enterprise term pack version is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.term_pack_id, NEW.revision,
      NEW.source_locale, NEW.target_locale, NEW.country_code,
      NEW.product_code, NEW.usage_scope, NEW.created_at)
    IS DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.term_pack_id, OLD.revision,
      OLD.source_locale, OLD.target_locale, OLD.country_code,
      OLD.product_code, OLD.usage_scope, OLD.created_at)
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid enterprise term pack version mutation';
  END IF;
  IF OLD.status IN ('published', 'expired') THEN
    RAISE EXCEPTION 'published enterprise term pack version is immutable';
  END IF;
  IF (NEW.terms, NEW.content_hash) IS DISTINCT FROM (OLD.terms, OLD.content_hash) AND
    NOT (OLD.status = 'draft' AND NEW.status = 'review') THEN
    RAISE EXCEPTION 'enterprise term pack content is immutable after review';
  END IF;
  IF OLD.status = 'review' AND
    (NEW.reviewed_by, NEW.reviewed_at)
      IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at) THEN
    RAISE EXCEPTION 'enterprise term pack review metadata is immutable';
  END IF;
  IF (NEW.effective_from, NEW.expires_at, NEW.published_by, NEW.published_at)
    IS DISTINCT FROM
    (OLD.effective_from, OLD.expires_at, OLD.published_by, OLD.published_at)
    AND NOT (OLD.status = 'review' AND NEW.status = 'published') THEN
    RAISE EXCEPTION 'enterprise term pack publication metadata requires publish';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('review', 'failed')) OR
    (OLD.status = 'review' AND NEW.status IN ('published', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid enterprise term pack state transition';
  END IF;
  IF NEW.status = 'review' AND (
    jsonb_array_length(NEW.terms) < 1 OR NEW.content_hash IS NULL OR
    NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'enterprise term pack version is not reviewable';
  END IF;
  IF NEW.status = 'published' AND (
    OLD.status <> 'review' OR NEW.content_hash IS NULL OR
    NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL OR
    NEW.published_by IS NULL OR NEW.published_at IS NULL OR
    NEW.effective_from IS NULL OR
    NEW.effective_from < NEW.published_at - interval '5 minutes' OR
    (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.effective_from)
  ) THEN
    RAISE EXCEPTION 'enterprise term pack version is not publishable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_term_pack_version_guard
BEFORE UPDATE OR DELETE ON enterprise.term_pack_versions
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_term_pack_version_mutation();

CREATE OR REPLACE FUNCTION enterprise.guard_script_template_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'expired') THEN
      RAISE EXCEPTION 'published enterprise script template version is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.script_template_id, NEW.revision,
      NEW.locale, NEW.country_code, NEW.product_code, NEW.created_at)
    IS DISTINCT FROM
    (OLD.id, OLD.tenant_id, OLD.script_template_id, OLD.revision,
      OLD.locale, OLD.country_code, OLD.product_code, OLD.created_at)
    OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid enterprise script template version mutation';
  END IF;
  IF OLD.status IN ('published', 'expired') THEN
    RAISE EXCEPTION 'published enterprise script template version is immutable';
  END IF;
  IF (NEW.prompt_text, NEW.required_phrases, NEW.prohibited_phrases,
      NEW.variables, NEW.content_hash)
    IS DISTINCT FROM
    (OLD.prompt_text, OLD.required_phrases, OLD.prohibited_phrases,
      OLD.variables, OLD.content_hash)
    AND NOT (OLD.status = 'draft' AND NEW.status = 'review') THEN
    RAISE EXCEPTION 'enterprise script template content is immutable after review';
  END IF;
  IF OLD.status = 'review' AND
    (NEW.reviewed_by, NEW.reviewed_at)
      IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at) THEN
    RAISE EXCEPTION 'enterprise script review metadata is immutable';
  END IF;
  IF (NEW.effective_from, NEW.expires_at, NEW.published_by, NEW.published_at)
    IS DISTINCT FROM
    (OLD.effective_from, OLD.expires_at, OLD.published_by, OLD.published_at)
    AND NOT (OLD.status = 'review' AND NEW.status = 'published') THEN
    RAISE EXCEPTION 'enterprise script publication metadata requires publish';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('review', 'failed')) OR
    (OLD.status = 'review' AND NEW.status IN ('published', 'failed'))
  ) THEN
    RAISE EXCEPTION 'invalid enterprise script template state transition';
  END IF;
  IF NEW.status = 'review' AND (
    length(btrim(NEW.prompt_text)) < 1 OR NEW.content_hash IS NULL OR
    NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'enterprise script template version is not reviewable';
  END IF;
  IF NEW.status = 'published' AND (
    OLD.status <> 'review' OR NEW.content_hash IS NULL OR
    NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL OR
    NEW.published_by IS NULL OR NEW.published_at IS NULL OR
    NEW.effective_from IS NULL OR
    NEW.effective_from < NEW.published_at - interval '5 minutes' OR
    (NEW.expires_at IS NOT NULL AND NEW.expires_at <= NEW.effective_from)
  ) THEN
    RAISE EXCEPTION 'enterprise script template version is not publishable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_script_template_version_guard
BEFORE UPDATE OR DELETE ON enterprise.script_template_versions
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_script_template_version_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'term_pack_versions', 'script_templates', 'script_template_versions'
  ] LOOP
    EXECUTE format('ALTER TABLE enterprise.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE enterprise.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON enterprise.%I USING (tenant_id = enterprise.current_tenant_id()) WITH CHECK (tenant_id = enterprise.current_tenant_id())',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END;
$$;
