CREATE OR REPLACE FUNCTION enterprise.is_support_quality_phrase_array(
  value text[], minimum_count integer, maximum_count integer
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item text;
BEGIN
  IF value IS NULL OR cardinality(value) < minimum_count OR
    cardinality(value) > maximum_count OR array_position(value, NULL) IS NOT NULL THEN
    RETURN false;
  END IF;
  FOREACH item IN ARRAY value LOOP
    IF item <> btrim(item) OR octet_length(item) NOT BETWEEN 1 AND 240 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE enterprise.support_agent_runs
  ADD CONSTRAINT support_agent_runs_quality_binding_key
  UNIQUE (tenant_id, id, support_session_id);
ALTER TABLE enterprise.support_agent_turns
  ADD CONSTRAINT support_agent_turns_quality_binding_key
  UNIQUE (tenant_id, id, run_id, support_session_id);

CREATE TABLE enterprise.support_quality_rule_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  revision bigint NOT NULL CHECK (revision >= 1),
  engine_version text NOT NULL CHECK (engine_version = 'support-quality-v1'),
  locale text NOT NULL CHECK (
    locale = '*' OR locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  ),
  identity_disclosure_phrases text[] NOT NULL,
  prohibited_promise_phrases text[] NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  published_by text NOT NULL CHECK (
    enterprise.is_account_subject_id(published_by)
  ),
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version = 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, revision),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (enterprise.is_support_quality_phrase_array(
    identity_disclosure_phrases, 1, 16
  )),
  CHECK (enterprise.is_support_quality_phrase_array(
    prohibited_promise_phrases, 0, 32
  )),
  CHECK (published_at = created_at)
);
CREATE INDEX support_quality_rule_versions_resolution_idx
  ON enterprise.support_quality_rule_versions (
    tenant_id, locale, published_at DESC, revision DESC
  );

CREATE TABLE enterprise.support_quality_reviews (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  support_session_id uuid NOT NULL,
  run_id uuid NOT NULL,
  rule_version_id uuid NOT NULL,
  engine_version text NOT NULL CHECK (engine_version = 'support-quality-v1'),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('complete', 'partial')),
  semantic_status text NOT NULL CHECK (
    semantic_status IN ('ready', 'not_configured', 'failed')
  ),
  semantic_reason_code text CHECK (
    semantic_reason_code IS NULL OR
    semantic_reason_code ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  evaluated_turn_count integer NOT NULL CHECK (evaluated_turn_count >= 0),
  evaluated_rule_count integer NOT NULL CHECK (evaluated_rule_count >= 1),
  finding_count integer NOT NULL CHECK (finding_count >= 0),
  critical_count integer NOT NULL CHECK (critical_count >= 0),
  high_count integer NOT NULL CHECK (high_count >= 0),
  medium_count integer NOT NULL CHECK (medium_count >= 0),
  analyzed_by text NOT NULL CHECK (
    enterprise.is_account_subject_id(analyzed_by)
  ),
  analyzed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version = 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, id, run_id, support_session_id),
  UNIQUE (tenant_id, support_session_id, rule_version_id, source_hash),
  FOREIGN KEY (tenant_id, support_session_id)
    REFERENCES enterprise.support_sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id, support_session_id)
    REFERENCES enterprise.support_agent_runs (
      tenant_id, id, support_session_id
    ),
  FOREIGN KEY (tenant_id, rule_version_id)
    REFERENCES enterprise.support_quality_rule_versions (tenant_id, id),
  CHECK (status = 'partial' AND semantic_status = 'not_configured' AND
    semantic_reason_code = 'support_quality_semantic_model_not_configured'),
  CHECK (finding_count = critical_count + high_count + medium_count),
  CHECK (analyzed_at = created_at)
);
CREATE INDEX support_quality_reviews_dashboard_idx
  ON enterprise.support_quality_reviews (
    tenant_id, analyzed_at DESC, finding_count DESC, id
  );

CREATE TABLE enterprise.support_quality_findings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  review_id uuid NOT NULL,
  support_session_id uuid NOT NULL,
  run_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  turn_sequence bigint NOT NULL CHECK (turn_sequence >= 1),
  code text NOT NULL CHECK (code IN (
    'identity_disclosure_missing', 'answer_without_citation',
    'risk_without_handoff', 'prohibited_promise', 'response_not_delivered'
  )),
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium')),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version = 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, review_id, code, turn_id),
  FOREIGN KEY (tenant_id, review_id, run_id, support_session_id)
    REFERENCES enterprise.support_quality_reviews (
      tenant_id, id, run_id, support_session_id
    ),
  FOREIGN KEY (tenant_id, turn_id, run_id, support_session_id)
    REFERENCES enterprise.support_agent_turns (
      tenant_id, id, run_id, support_session_id
    ),
  CHECK (
    (code = 'risk_without_handoff' AND severity = 'critical') OR
    (code IN ('answer_without_citation', 'prohibited_promise',
      'response_not_delivered') AND severity = 'high') OR
    (code = 'identity_disclosure_missing' AND severity = 'medium')
  )
);
CREATE INDEX support_quality_findings_dashboard_idx
  ON enterprise.support_quality_findings (
    tenant_id, severity, code, created_at DESC, id
  );

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'support_quality_rule_versions', 'support_quality_reviews',
    'support_quality_findings'
  ] LOOP
    EXECUTE format('ALTER TABLE enterprise.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE enterprise.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON enterprise.%I USING '
      '(tenant_id = enterprise.current_tenant_id()) WITH CHECK '
      '(tenant_id = enterprise.current_tenant_id())', table_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION enterprise.guard_support_quality_rule_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM enterprise.members
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.published_by AND
      status = 'active' AND role IN ('owner', 'admin', 'support_manager')
  ) THEN
    RAISE EXCEPTION 'enterprise support quality rule publisher is not eligible';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_quality_rule_versions_insert_guard BEFORE INSERT
  ON enterprise.support_quality_rule_versions FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_quality_rule_insert();

CREATE OR REPLACE FUNCTION enterprise.guard_support_quality_review_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM enterprise.support_sessions session
    JOIN enterprise.support_agent_runs run
      ON run.tenant_id = session.tenant_id AND
        run.support_session_id = session.id AND run.id = NEW.run_id
    JOIN enterprise.support_quality_rule_versions rule
      ON rule.tenant_id = session.tenant_id AND rule.id = NEW.rule_version_id
    JOIN enterprise.members member
      ON member.tenant_id = session.tenant_id AND member.user_id = NEW.analyzed_by
    WHERE session.tenant_id = NEW.tenant_id AND
      session.id = NEW.support_session_id AND session.status IN ('ended', 'failed') AND
      run.status IN ('completed', 'failed', 'cancelled') AND
      rule.engine_version = NEW.engine_version AND member.status = 'active' AND
      member.role IN ('owner', 'admin', 'support_manager')
  ) THEN
    RAISE EXCEPTION 'enterprise support quality review binding is not eligible';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_quality_reviews_insert_guard BEFORE INSERT
  ON enterprise.support_quality_reviews FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_quality_review_insert();

CREATE OR REPLACE FUNCTION enterprise.guard_support_quality_evidence_counts()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_review_id uuid;
DECLARE expected record;
DECLARE actual record;
BEGIN
  target_review_id := CASE WHEN TG_TABLE_NAME = 'support_quality_reviews'
    THEN NEW.id ELSE NEW.review_id END;
  SELECT finding_count, critical_count, high_count, medium_count
    INTO expected
    FROM enterprise.support_quality_reviews
    WHERE tenant_id = NEW.tenant_id AND id = target_review_id;
  SELECT count(*)::integer AS finding_count,
    count(*) FILTER (WHERE severity = 'critical')::integer AS critical_count,
    count(*) FILTER (WHERE severity = 'high')::integer AS high_count,
    count(*) FILTER (WHERE severity = 'medium')::integer AS medium_count
    INTO actual
    FROM enterprise.support_quality_findings
    WHERE tenant_id = NEW.tenant_id AND review_id = target_review_id;
  IF expected IS NULL OR ROW(expected.finding_count, expected.critical_count,
      expected.high_count, expected.medium_count) IS DISTINCT FROM
    ROW(actual.finding_count, actual.critical_count, actual.high_count,
      actual.medium_count) THEN
    RAISE EXCEPTION 'enterprise support quality evidence counts are inconsistent';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER support_quality_reviews_evidence_count_guard
  AFTER INSERT ON enterprise.support_quality_reviews
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_quality_evidence_counts();
CREATE CONSTRAINT TRIGGER support_quality_findings_evidence_count_guard
  AFTER INSERT ON enterprise.support_quality_findings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_quality_evidence_counts();

CREATE OR REPLACE FUNCTION enterprise.reject_support_quality_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise support quality evidence is immutable';
END;
$$;
CREATE TRIGGER support_quality_rule_versions_immutable
  BEFORE UPDATE OR DELETE ON enterprise.support_quality_rule_versions
  FOR EACH ROW EXECUTE FUNCTION enterprise.reject_support_quality_mutation();
CREATE TRIGGER support_quality_reviews_immutable
  BEFORE UPDATE OR DELETE ON enterprise.support_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION enterprise.reject_support_quality_mutation();
CREATE TRIGGER support_quality_findings_immutable
  BEFORE UPDATE OR DELETE ON enterprise.support_quality_findings
  FOR EACH ROW EXECUTE FUNCTION enterprise.reject_support_quality_mutation();
