DROP FUNCTION IF EXISTS enterprise.cell_admission_readiness(text, text);
DROP FUNCTION IF EXISTS enterprise.reconcile_cell_admission(
  text, text, text, timestamptz
);
DROP FUNCTION IF EXISTS enterprise.cell_admission_status(text, text, text);
DROP FUNCTION IF EXISTS enterprise.configure_tenant_admission_weight(
  text, uuid, text, integer, bigint, text, timestamptz
);
DROP FUNCTION IF EXISTS enterprise.configure_cell_admission_policy(
  text, text, integer, integer, integer, integer, integer, integer,
  integer, text, bigint, text, timestamptz
);
DROP FUNCTION IF EXISTS enterprise.tenant_admission_is_active(
  uuid, text, text, text, timestamptz
);
DROP FUNCTION IF EXISTS enterprise.release_tenant_admission(
  uuid, text, text, timestamptz
);
DROP FUNCTION IF EXISTS enterprise.renew_tenant_admission(
  uuid, text, text, text, timestamptz, timestamptz
);
DROP FUNCTION IF EXISTS enterprise.reserve_tenant_admission(
  uuid, uuid, text, text, text, text, text, integer, integer,
  timestamptz, timestamptz
);
DROP TABLE IF EXISTS enterprise.tenant_admission_requests;
DROP TABLE IF EXISTS enterprise.cell_tenant_admission_state;
DROP TABLE IF EXISTS enterprise.cell_admission_state;
DROP TABLE IF EXISTS enterprise.cell_admission_policies;
DROP FUNCTION IF EXISTS enterprise.current_admission_operator_id();
