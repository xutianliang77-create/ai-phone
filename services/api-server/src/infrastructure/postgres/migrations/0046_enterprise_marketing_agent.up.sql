CREATE TABLE enterprise.marketing_agent_profiles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  campaign_id uuid NOT NULL,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  locale text NOT NULL CHECK (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  brand_name text NOT NULL CHECK (octet_length(btrim(brand_name)) BETWEEN 1 AND 200),
  agent_identity text NOT NULL CHECK (octet_length(btrim(agent_identity)) BETWEEN 1 AND 500),
  call_purpose text NOT NULL CHECK (octet_length(btrim(call_purpose)) BETWEEN 1 AND 1000),
  product_code text NOT NULL CHECK (product_code ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  value_proposition text NOT NULL CHECK (
    octet_length(btrim(value_proposition)) BETWEEN 1 AND 2000
  ),
  target_market text NOT NULL CHECK (octet_length(btrim(target_market)) BETWEEN 1 AND 1000),
  term_pack_id uuid NOT NULL,
  script_template_id uuid NOT NULL,
  voice_preset_id text NOT NULL CHECK (
    voice_preset_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
  ),
  opening_disclosure text NOT NULL CHECK (
    octet_length(btrim(opening_disclosure)) BETWEEN 1 AND 2000
  ),
  qualification_questions jsonb NOT NULL CHECK (
    jsonb_typeof(qualification_questions) = 'array' AND
    jsonb_array_length(qualification_questions) BETWEEN 1 AND 20 AND
    octet_length(qualification_questions::text) <= 12000
  ),
  opt_out_phrases jsonb NOT NULL CHECK (
    jsonb_typeof(opt_out_phrases) = 'array' AND
    jsonb_array_length(opt_out_phrases) BETWEEN 1 AND 40 AND
    octet_length(opt_out_phrases::text) <= 12000
  ),
  handoff_phrases jsonb NOT NULL CHECK (
    jsonb_typeof(handoff_phrases) = 'array' AND
    jsonb_array_length(handoff_phrases) BETWEEN 1 AND 40 AND
    octet_length(handoff_phrases::text) <= 12000
  ),
  closing_text text NOT NULL CHECK (octet_length(btrim(closing_text)) BETWEEN 1 AND 2000),
  created_by text NOT NULL CHECK (enterprise.is_account_subject_id(created_by)),
  creation_key text NOT NULL CHECK (
    creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  creation_request_hash text NOT NULL CHECK (creation_request_hash ~ '^[a-f0-9]{64}$'),
  last_command_key text NOT NULL CHECK (
    last_command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  last_command_hash text NOT NULL CHECK (last_command_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, campaign_id, country_code, locale),
  UNIQUE (tenant_id, created_by, creation_key),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, term_pack_id)
    REFERENCES enterprise.term_packs (tenant_id, id),
  FOREIGN KEY (tenant_id, script_template_id)
    REFERENCES enterprise.script_templates (tenant_id, id),
  CHECK (updated_at >= created_at)
);

CREATE TABLE enterprise.marketing_agent_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  dispatch_id uuid NOT NULL,
  task_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  communication_session_id text NOT NULL,
  dispatch_generation bigint NOT NULL CHECK (dispatch_generation > 0),
  route_epoch bigint NOT NULL CHECK (route_epoch > 0),
  profile_id uuid NOT NULL,
  profile_version bigint NOT NULL CHECK (profile_version > 0),
  term_pack_version_id uuid NOT NULL,
  script_template_version_id uuid NOT NULL,
  content_context_hash text NOT NULL CHECK (content_context_hash ~ '^[a-f0-9]{64}$'),
  provider_fingerprint text NOT NULL CHECK (
    provider_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  status text NOT NULL CHECK (status IN (
    'active', 'handoff_requested', 'ending', 'completed', 'failed', 'cancelled'
  )),
  locale text NOT NULL CHECK (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  conversation_state text NOT NULL CHECK (conversation_state IN (
    'disclosure', 'qualifying', 'presenting', 'objection_handling', 'handoff', 'ending'
  )),
  disclosure_text text NOT NULL CHECK (
    octet_length(btrim(disclosure_text)) BETWEEN 1 AND 2000
  ),
  disclosure_authorized_at timestamptz,
  disclosure_delivered_at timestamptz,
  context_document jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(context_document) = 'array' AND octet_length(context_document::text) <= 8000
  ),
  context_hash text NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  last_turn_sequence bigint NOT NULL DEFAULT 0 CHECK (last_turn_sequence >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dispatch_id),
  UNIQUE (tenant_id, task_id, dispatch_generation),
  FOREIGN KEY (tenant_id, dispatch_id)
    REFERENCES enterprise.marketing_pstn_dispatches (tenant_id, id),
  FOREIGN KEY (tenant_id, task_id)
    REFERENCES enterprise.marketing_call_tasks (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id)
    REFERENCES enterprise.marketing_campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id)
    REFERENCES enterprise.marketing_leads (tenant_id, id),
  FOREIGN KEY (tenant_id, profile_id)
    REFERENCES enterprise.marketing_agent_profiles (tenant_id, id),
  FOREIGN KEY (tenant_id, term_pack_version_id)
    REFERENCES enterprise.term_pack_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, script_template_version_id)
    REFERENCES enterprise.script_template_versions (tenant_id, id),
  CHECK (updated_at >= created_at AND
    (disclosure_authorized_at IS NULL OR disclosure_authorized_at >= created_at) AND
    (disclosure_delivered_at IS NULL OR
      (disclosure_authorized_at IS NOT NULL AND
        disclosure_delivered_at >= disclosure_authorized_at)) AND
    ((conversation_state = 'disclosure' AND disclosure_delivered_at IS NULL) OR
      (conversation_state <> 'disclosure' AND disclosure_delivered_at IS NOT NULL)))
);
CREATE INDEX marketing_agent_runs_recovery_idx ON enterprise.marketing_agent_runs
  (tenant_id, status, updated_at, id)
  WHERE status IN ('active', 'handoff_requested', 'ending');

CREATE TABLE enterprise.marketing_agent_turns (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES enterprise.tenants (id),
  run_id uuid NOT NULL,
  input_turn_id text NOT NULL CHECK (
    input_turn_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  sequence bigint NOT NULL CHECK (sequence > 0),
  status text NOT NULL CHECK (status IN (
    'prepared', 'generated', 'degraded', 'handoff', 'ended',
    'tts_authorized', 'delivered', 'failed', 'cancelled'
  )),
  locale text NOT NULL CHECK (locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  profile_id uuid NOT NULL,
  profile_version bigint NOT NULL CHECK (profile_version > 0),
  term_pack_version_id uuid NOT NULL,
  script_template_version_id uuid NOT NULL,
  content_context_hash text NOT NULL CHECK (content_context_hash ~ '^[a-f0-9]{64}$'),
  customer_text_hash text NOT NULL CHECK (customer_text_hash ~ '^[a-f0-9]{64}$'),
  context_hash text NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  spoken_text text CHECK (
    spoken_text IS NULL OR octet_length(btrim(spoken_text)) BETWEEN 1 AND 2000
  ),
  intent text CHECK (intent IS NULL OR intent IN (
    'qualify', 'inform', 'handle_objection', 'handoff', 'end'
  )),
  conversation_state text CHECK (conversation_state IS NULL OR conversation_state IN (
    'qualifying', 'presenting', 'objection_handling', 'handoff', 'ending'
  )),
  action text CHECK (action IS NULL OR action IN ('continue', 'handoff', 'end_call')),
  risk_signals jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(risk_signals) = 'array' AND octet_length(risk_signals::text) <= 2000
  ),
  knowledge_citations text[] NOT NULL DEFAULT '{}'::text[] CHECK (
    cardinality(knowledge_citations) <= 16 AND array_position(knowledge_citations, NULL) IS NULL
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
  version bigint NOT NULL CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, run_id, input_turn_id),
  UNIQUE (tenant_id, run_id, idempotency_key),
  UNIQUE (tenant_id, run_id, sequence),
  FOREIGN KEY (tenant_id, run_id)
    REFERENCES enterprise.marketing_agent_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, profile_id)
    REFERENCES enterprise.marketing_agent_profiles (tenant_id, id),
  FOREIGN KEY (tenant_id, term_pack_version_id)
    REFERENCES enterprise.term_pack_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, script_template_version_id)
    REFERENCES enterprise.script_template_versions (tenant_id, id),
  CHECK (updated_at >= created_at AND
    (tts_authorized_at IS NULL OR tts_authorized_at >= created_at) AND
    (delivered_at IS NULL OR delivered_at >= tts_authorized_at)),
  CHECK (
    (status = 'prepared' AND spoken_text IS NULL AND intent IS NULL AND action IS NULL) OR
    (status IN ('generated', 'degraded', 'handoff', 'ended') AND
      spoken_text IS NOT NULL AND intent IS NOT NULL AND action IS NOT NULL) OR
    (status = 'tts_authorized' AND spoken_text IS NOT NULL AND intent IS NOT NULL AND
      action IS NOT NULL AND tts_authorized_at IS NOT NULL) OR
    (status = 'delivered' AND spoken_text IS NOT NULL AND intent IS NOT NULL AND
      action IS NOT NULL AND tts_authorized_at IS NOT NULL AND delivered_at IS NOT NULL) OR
    status IN ('failed', 'cancelled')
  )
);
CREATE INDEX marketing_agent_turns_run_idx ON enterprise.marketing_agent_turns
  (tenant_id, run_id, sequence, id);

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_agent_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.tenant_id IS DISTINCT FROM enterprise.current_tenant_id() OR
    NOT enterprise.is_account_subject_id(enterprise.current_user_id()) OR NOT EXISTS (
      SELECT 1 FROM enterprise.marketing_campaigns campaign
      WHERE campaign.tenant_id = NEW.tenant_id AND campaign.id = NEW.campaign_id
        AND campaign.status = 'draft' AND campaign.approval_status = 'not_submitted'
    ) THEN RAISE EXCEPTION 'invalid enterprise marketing agent profile mutation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM enterprise.current_user_id() OR NEW.version <> 1 OR
      NEW.updated_at IS DISTINCT FROM NEW.created_at OR
      NEW.last_command_key IS DISTINCT FROM NEW.creation_key OR
      NEW.last_command_hash IS DISTINCT FROM NEW.creation_request_hash THEN
      RAISE EXCEPTION 'invalid enterprise marketing agent profile creation';
    END IF;
    IF strpos(lower(NEW.opening_disclosure), lower(NEW.brand_name)) = 0 OR
      strpos(lower(NEW.opening_disclosure), lower(NEW.agent_identity)) = 0 OR
      strpos(lower(NEW.opening_disclosure), lower(NEW.call_purpose)) = 0 THEN
      RAISE EXCEPTION 'enterprise marketing agent disclosure is incomplete';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.campaign_id, NEW.country_code, NEW.locale,
      NEW.created_by, NEW.creation_key, NEW.creation_request_hash, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.campaign_id, OLD.country_code,
      OLD.locale, OLD.created_by, OLD.creation_key, OLD.creation_request_hash, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'invalid enterprise marketing agent profile version';
  END IF;
  IF strpos(lower(NEW.opening_disclosure), lower(NEW.brand_name)) = 0 OR
    strpos(lower(NEW.opening_disclosure), lower(NEW.agent_identity)) = 0 OR
    strpos(lower(NEW.opening_disclosure), lower(NEW.call_purpose)) = 0 THEN
    RAISE EXCEPTION 'enterprise marketing agent disclosure is incomplete';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_agent_profiles_guard BEFORE INSERT OR UPDATE OR DELETE
  ON enterprise.marketing_agent_profiles FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_marketing_agent_profile();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_agent_run()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'enterprise marketing agent run cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF enterprise.current_user_id() <> 'system:enterprise-marketing-pstn' OR
      NEW.status <> 'active' OR NEW.conversation_state <> 'disclosure' OR NEW.version <> 1 OR
      NEW.disclosure_authorized_at IS NOT NULL OR NEW.disclosure_delivered_at IS NOT NULL OR
      NEW.last_turn_sequence <> 0 OR NEW.updated_at IS DISTINCT FROM NEW.created_at OR
      NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_pstn_dispatches dispatch
        JOIN enterprise.marketing_call_tasks task
          ON task.tenant_id = dispatch.tenant_id AND task.id = dispatch.task_id
        JOIN enterprise.marketing_leads lead
          ON lead.tenant_id = task.tenant_id AND lead.id = task.lead_id
        JOIN enterprise.marketing_agent_profiles profile
          ON profile.tenant_id = task.tenant_id AND profile.id = NEW.profile_id
          AND profile.campaign_id = task.campaign_id AND profile.country_code = lead.country_code
          AND profile.locale = NEW.locale AND profile.version = NEW.profile_version
        JOIN enterprise.term_pack_versions term_version
          ON term_version.tenant_id = profile.tenant_id
          AND term_version.id = NEW.term_pack_version_id
          AND term_version.term_pack_id = profile.term_pack_id
          AND term_version.status = 'published'
          AND term_version.effective_from <= NEW.created_at
          AND (term_version.expires_at IS NULL OR term_version.expires_at > NEW.created_at)
        JOIN enterprise.script_template_versions script_version
          ON script_version.tenant_id = profile.tenant_id
          AND script_version.id = NEW.script_template_version_id
          AND script_version.script_template_id = profile.script_template_id
          AND script_version.status = 'published'
          AND script_version.effective_from <= NEW.created_at
          AND (script_version.expires_at IS NULL OR script_version.expires_at > NEW.created_at)
        WHERE dispatch.tenant_id = NEW.tenant_id AND dispatch.id = NEW.dispatch_id
          AND dispatch.task_id = NEW.task_id AND dispatch.campaign_id = NEW.campaign_id
          AND dispatch.communication_session_id = NEW.communication_session_id
          AND dispatch.dispatch_generation = NEW.dispatch_generation
          AND dispatch.route_epoch = NEW.route_epoch AND dispatch.status = 'prepared'
          AND task.lead_id = NEW.lead_id
      ) THEN
      RAISE EXCEPTION 'invalid enterprise marketing agent run creation';
    END IF;
    RETURN NEW;
  END IF;
  IF enterprise.current_user_id() <> 'system:enterprise-marketing-agent' OR
    ROW(NEW.id, NEW.tenant_id, NEW.dispatch_id, NEW.task_id, NEW.campaign_id, NEW.lead_id,
      NEW.communication_session_id, NEW.dispatch_generation, NEW.route_epoch, NEW.profile_id,
      NEW.profile_version, NEW.term_pack_version_id, NEW.script_template_version_id,
      NEW.content_context_hash, NEW.provider_fingerprint, NEW.disclosure_text, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.dispatch_id, OLD.task_id, OLD.campaign_id,
      OLD.lead_id, OLD.communication_session_id, OLD.dispatch_generation, OLD.route_epoch,
      OLD.profile_id, OLD.profile_version, OLD.term_pack_version_id,
      OLD.script_template_version_id, OLD.content_context_hash, OLD.provider_fingerprint,
      OLD.disclosure_text, OLD.created_at) OR NEW.version <> OLD.version + 1 OR
    NEW.updated_at <= OLD.updated_at OR OLD.status IN ('completed', 'failed', 'cancelled') OR
    NOT (NEW.status = OLD.status OR
      (OLD.status = 'active' AND NEW.status IN
        ('handoff_requested', 'ending', 'completed', 'failed', 'cancelled')) OR
      (OLD.status IN ('handoff_requested', 'ending') AND
        NEW.status IN ('completed', 'failed', 'cancelled'))) THEN
    RAISE EXCEPTION 'invalid enterprise marketing agent run mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_agent_runs_guard BEFORE INSERT OR UPDATE OR DELETE
  ON enterprise.marketing_agent_runs FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_marketing_agent_run();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_agent_turn()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR enterprise.current_user_id() <> 'system:enterprise-marketing-agent' THEN
    RAISE EXCEPTION 'invalid enterprise marketing agent turn actor';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'prepared' OR NEW.version <> 1 OR
      NEW.updated_at IS DISTINCT FROM NEW.created_at OR NOT EXISTS (
        SELECT 1 FROM enterprise.marketing_agent_runs run
        JOIN enterprise.marketing_agent_profiles profile
          ON profile.tenant_id = run.tenant_id AND profile.id = NEW.profile_id
          AND profile.campaign_id = run.campaign_id AND profile.locale = NEW.locale
          AND profile.version = NEW.profile_version
        JOIN enterprise.term_pack_versions term_version
          ON term_version.tenant_id = profile.tenant_id
          AND term_version.id = NEW.term_pack_version_id
          AND term_version.term_pack_id = profile.term_pack_id
          AND term_version.status = 'published'
        JOIN enterprise.script_template_versions script_version
          ON script_version.tenant_id = profile.tenant_id
          AND script_version.id = NEW.script_template_version_id
          AND script_version.script_template_id = profile.script_template_id
          AND script_version.status = 'published'
        WHERE run.tenant_id = NEW.tenant_id AND run.id = NEW.run_id
          AND run.status = 'active' AND run.disclosure_delivered_at IS NOT NULL
      ) THEN
      RAISE EXCEPTION 'invalid enterprise marketing agent turn creation';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.run_id, NEW.input_turn_id, NEW.idempotency_key,
      NEW.request_hash, NEW.sequence, NEW.locale, NEW.profile_id, NEW.profile_version,
      NEW.term_pack_version_id, NEW.script_template_version_id, NEW.content_context_hash,
      NEW.customer_text_hash, NEW.context_hash, NEW.evidence_hash, NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_id, OLD.run_id, OLD.input_turn_id, OLD.idempotency_key,
      OLD.request_hash, OLD.sequence, OLD.locale, OLD.profile_id, OLD.profile_version,
      OLD.term_pack_version_id, OLD.script_template_version_id, OLD.content_context_hash,
      OLD.customer_text_hash, OLD.context_hash, OLD.evidence_hash, OLD.created_at) OR
    NEW.version <> OLD.version + 1 OR
    NEW.updated_at <= OLD.updated_at OR
    OLD.status IN ('delivered', 'failed', 'cancelled') OR NOT (
      (OLD.status = 'prepared' AND NEW.status IN
        ('generated', 'degraded', 'handoff', 'ended', 'failed', 'cancelled')) OR
      (OLD.status IN ('generated', 'degraded', 'handoff', 'ended') AND
        NEW.status IN ('tts_authorized', 'cancelled')) OR
      (OLD.status = 'tts_authorized' AND NEW.status IN ('delivered', 'cancelled'))
    ) THEN RAISE EXCEPTION 'invalid enterprise marketing agent turn mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_agent_turns_guard BEFORE INSERT OR UPDATE OR DELETE
  ON enterprise.marketing_agent_turns FOR EACH ROW
  EXECUTE FUNCTION enterprise.guard_marketing_agent_turn();

CREATE OR REPLACE FUNCTION enterprise.guard_marketing_agent_task_dispatch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM enterprise.marketing_agent_runs run
    WHERE run.tenant_id = NEW.tenant_id AND run.task_id = NEW.id
      AND run.campaign_id = NEW.campaign_id
      AND run.dispatch_generation = NEW.dispatch_generation
      AND run.status = 'active' AND run.conversation_state = 'disclosure'
  ) THEN RAISE EXCEPTION 'enterprise Marketing Agent run required before dispatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER marketing_call_tasks_agent_dispatch_guard
BEFORE UPDATE ON enterprise.marketing_call_tasks
FOR EACH ROW WHEN (OLD.status = 'dispatching' AND NEW.status = 'dispatched')
EXECUTE FUNCTION enterprise.guard_marketing_agent_task_dispatch();

ALTER TABLE enterprise.suppression_entries
  DROP CONSTRAINT suppression_entries_v2_shape_check;
ALTER TABLE enterprise.suppression_entries
  ADD CONSTRAINT suppression_entries_v2_shape_check CHECK (
    lead_id IS NULL OR (
      phone_hash ~ '^[a-f0-9]{64}$' AND scope IN ('tenant', 'global') AND
      char_length(reason) BETWEEN 1 AND 500 AND reason = btrim(reason) AND
      source IN ('manual', 'contact_request', 'consent_withdrawal',
        'complaint', 'global_registry') AND source_reference IS NOT NULL AND
      char_length(source_reference) BETWEEN 1 AND 200 AND source_reference = btrim(source_reference) AND
      created_by IS NOT NULL AND enterprise.is_actor_subject_id(created_by) AND
      updated_at IS NOT NULL AND version = 1 AND creation_key IS NOT NULL AND
      creation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' AND
      creation_request_hash ~ '^[a-f0-9]{64}$' AND
      cancelled_task_count IS NOT NULL AND cancelled_task_count >= 0 AND
      ((scope = 'tenant' AND origin_campaign_id IS NOT NULL AND
        ((enterprise.is_account_subject_id(created_by) AND source <> 'global_registry') OR
          (created_by = 'system:enterprise-marketing-agent' AND source = 'contact_request'))) OR
       (scope = 'global' AND origin_campaign_id IS NULL AND
        NOT enterprise.is_account_subject_id(created_by) AND source = 'global_registry'))
    )
  ) NOT VALID;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'marketing_agent_profiles', 'marketing_agent_runs', 'marketing_agent_turns'
  ] LOOP
    EXECUTE format('ALTER TABLE enterprise.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE enterprise.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON enterprise.%I USING '
      '(tenant_id = enterprise.current_tenant_id()) WITH CHECK '
      '(tenant_id = enterprise.current_tenant_id())', table_name);
  END LOOP;
END;
$$;
