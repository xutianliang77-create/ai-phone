export function markProviderChecksDeferred(checks) {
  const names = new Set([
    "pstn_bridge_release_ready",
    "pstn_provider_media_event_readiness",
    "pstn_provider_status_event_readiness",
    "pstn_internal_media_loop_readiness",
    "agent_call_worker_readiness",
    "domestic_payment_callbacks_local_smoke",
  ]);
  for (const check of checks) {
    if (!names.has(check.name) || check.details?.skipped !== true) continue;
    check.status = "deferred";
    check.details = {
      ...check.details,
      disposition: "deferred_by_core_translation_profile",
    };
  }
}
