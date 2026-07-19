CREATE TABLE IF NOT EXISTS public.ai_phone_ha_probe (
  run_id text NOT NULL,
  probe_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, probe_id)
);

REVOKE ALL ON public.ai_phone_ha_probe FROM PUBLIC;
