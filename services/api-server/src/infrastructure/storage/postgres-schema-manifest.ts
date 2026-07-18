export const expectedPostgresMigrations = [
  "001_communication_core",
  "002_orchestration_recording_agent",
  "003_projection_apply",
  "004_agent_orchestration_projection",
  "005_ingress_projection",
  "006_idempotency_scope",
  "007_recording_artifact_lifecycle",
  "008_recording_targets",
  "009_agent_call_leases",
  "010_ingress_source_policy",
  "011_primary_cutover_foundation",
  "012_observability_trace",
  "013_region_fencing",
  "014_srt_ingress_bridge",
  "015_primary_record_unit_of_work",
  "016_agent_consult_projection",
  "017_primary_command_inbox",
  "018_reliable_inbox",
  "019_usage_accounting",
  "020_worker_capacity_fencing",
  "021_domain_capacity_locks",
  "022_agent_primary_idempotency",
  "023_aggregate_lease_renewal",
  "024_reliable_inbox_leases",
  "025_agent_phone_reference_security",
  "026_agent_task_primary",
  "027_billing_atomicity",
  "028_product_records_primary",
  "029_projection_runtime_compatibility",
  "030_tts_playback_session_identity",
] as const;

export function comparePostgresMigrations(applied: string[]) {
  const expected = new Set<string>(expectedPostgresMigrations);
  const actual = new Set(applied);
  return {
    missing: expectedPostgresMigrations.filter((version) => !actual.has(version)),
    extra: [...actual].filter((version) => !expected.has(version)).sort(),
  };
}
