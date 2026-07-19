CREATE TABLE enterprise.support_agent_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  support_session_id uuid NOT NULL,
  communication_session_id text NOT NULL,
  dispatch_grant_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 1),
  status text NOT NULL CHECK (status IN (
    'active', 'handoff_requested', 'ending', 'completed', 'failed', 'cancelled'
  )),
  locale text NOT NULL CHECK (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  product_code text NOT NULL CHECK (product_code ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  conversation_state text NOT NULL CHECK (conversation_state IN (
    'qualifying', 'answering', 'handoff', 'ending'
  )),
  context_document jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(context_document) = 'array' AND
      octet_length(context_document::text) <= 8000),
  context_hash text NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  last_turn_sequence bigint NOT NULL DEFAULT 0 CHECK (last_turn_sequence >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, support_session_id, generation),
  FOREIGN KEY (tenant_id, support_session_id)
    REFERENCES enterprise.support_sessions (tenant_id, id),
  FOREIGN KEY (tenant_id, dispatch_grant_id)
    REFERENCES enterprise.worker_dispatch_grants (tenant_id, id),
  CHECK (updated_at >= created_at)
);
CREATE INDEX support_agent_runs_recovery_idx
  ON enterprise.support_agent_runs (tenant_id, status, updated_at, id)
  WHERE status IN ('active', 'handoff_requested', 'ending');

CREATE TABLE enterprise.support_agent_turns (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  run_id uuid NOT NULL,
  support_session_id uuid NOT NULL,
  input_turn_id text NOT NULL CHECK (
    input_turn_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  sequence bigint NOT NULL CHECK (sequence >= 1),
  status text NOT NULL CHECK (status IN (
    'prepared', 'generated', 'degraded', 'handoff', 'tts_authorized',
    'delivered', 'failed', 'cancelled'
  )),
  customer_text_hash text NOT NULL CHECK (customer_text_hash ~ '^[a-f0-9]{64}$'),
  context_hash text NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  spoken_text text CHECK (
    spoken_text IS NULL OR octet_length(btrim(spoken_text)) BETWEEN 1 AND 2000
  ),
  intent text CHECK (intent IS NULL OR intent IN ('qualify', 'answer', 'handoff', 'end')),
  conversation_state text CHECK (conversation_state IS NULL OR conversation_state IN (
    'qualifying', 'answering', 'handoff', 'ending'
  )),
  risk_signals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(risk_signals) = 'array' AND octet_length(risk_signals::text) <= 2000
  ),
  knowledge_citations text[] NOT NULL DEFAULT '{}'::text[] CHECK (
    cardinality(knowledge_citations) <= 16 AND
    array_position(knowledge_citations, NULL) IS NULL
  ),
  provider_fingerprint text CHECK (
    provider_fingerprint IS NULL OR
    provider_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{1,79}$'
  ),
  tts_authorized_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, run_id, idempotency_key),
  UNIQUE (tenant_id, run_id, sequence),
  FOREIGN KEY (tenant_id, run_id)
    REFERENCES enterprise.support_agent_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, support_session_id)
    REFERENCES enterprise.support_sessions (tenant_id, id),
  CHECK (updated_at >= created_at AND
    (tts_authorized_at IS NULL OR tts_authorized_at >= created_at) AND
    (delivered_at IS NULL OR delivered_at >= tts_authorized_at)),
  CHECK (
    (status = 'prepared' AND spoken_text IS NULL AND intent IS NULL) OR
    (status IN ('generated', 'degraded', 'handoff') AND
      spoken_text IS NOT NULL AND intent IS NOT NULL) OR
    (status = 'tts_authorized' AND spoken_text IS NOT NULL AND
      intent IS NOT NULL AND tts_authorized_at IS NOT NULL) OR
    (status = 'delivered' AND spoken_text IS NOT NULL AND
      intent IS NOT NULL AND delivered_at IS NOT NULL) OR
    status IN ('failed', 'cancelled')
  )
);
CREATE INDEX support_agent_turns_run_idx
  ON enterprise.support_agent_turns (tenant_id, run_id, sequence);

CREATE OR REPLACE FUNCTION enterprise.guard_support_agent_run_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.tenant_id, NEW.id, NEW.support_session_id,
    NEW.communication_session_id, NEW.dispatch_grant_id, NEW.generation,
    NEW.locale, NEW.country_code, NEW.product_code, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id, OLD.id, OLD.support_session_id,
    OLD.communication_session_id, OLD.dispatch_grant_id, OLD.generation,
    OLD.locale, OLD.country_code, OLD.product_code, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR
    OLD.status IN ('completed', 'failed', 'cancelled') OR NOT (
      NEW.status = OLD.status OR
      (OLD.status = 'active' AND NEW.status IN (
        'handoff_requested', 'ending', 'completed', 'failed', 'cancelled'
      )) OR
      (OLD.status = 'handoff_requested' AND NEW.status IN ('completed', 'failed', 'cancelled')) OR
      (OLD.status = 'ending' AND NEW.status IN ('completed', 'failed', 'cancelled'))
    ) THEN RAISE EXCEPTION 'invalid enterprise support agent run mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_agent_runs_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_agent_runs FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_agent_run_mutation();

CREATE OR REPLACE FUNCTION enterprise.guard_support_agent_turn_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.tenant_id, NEW.id, NEW.run_id,
    NEW.support_session_id, NEW.input_turn_id, NEW.idempotency_key,
    NEW.request_hash, NEW.sequence, NEW.customer_text_hash, NEW.context_hash,
    NEW.evidence_hash, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id, OLD.id, OLD.run_id,
    OLD.support_session_id, OLD.input_turn_id, OLD.idempotency_key,
    OLD.request_hash, OLD.sequence, OLD.customer_text_hash, OLD.context_hash,
    OLD.evidence_hash, OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    OLD.status IN ('delivered', 'failed', 'cancelled') OR NOT (
      (OLD.status = 'prepared' AND NEW.status IN (
        'generated', 'degraded', 'handoff', 'failed', 'cancelled'
      )) OR
      (OLD.status IN ('generated', 'degraded', 'handoff') AND
        NEW.status IN ('tts_authorized', 'cancelled')) OR
      (OLD.status = 'tts_authorized' AND NEW.status IN ('delivered', 'cancelled'))
    ) THEN RAISE EXCEPTION 'invalid enterprise support agent turn mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_agent_turns_guard BEFORE UPDATE OR DELETE
  ON enterprise.support_agent_turns FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_support_agent_turn_mutation();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['support_agent_runs', 'support_agent_turns']
  LOOP
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
