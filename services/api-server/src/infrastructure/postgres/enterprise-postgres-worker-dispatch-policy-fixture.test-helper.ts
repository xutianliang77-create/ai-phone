const tenantId = "00000000-0000-4000-8000-000000000001";

export function policyRow(change: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000021",
    tenant_id: tenantId,
    communication_session_id: "enterprise-session-1",
    policy_version: "policy-1",
    route_epoch: "7",
    generation: "3",
    asr_execution: "device",
    translation_execution: "cloud",
    tts_execution: "cloud",
    voice_identity_enabled: false,
    recording_enabled: false,
    diagnostic_audio_enabled: false,
    authorization_evidence_ids: [],
    allowed_capabilities: ["translation_runtime", "voice_agent_runtime"],
    runtime_state: "full",
    reason_code: "policy_full_runtime",
    fingerprints: { "asr.device": "asr-v1" },
    readiness_expires_at: "2026-07-18T05:05:00.000Z",
    request_hash: "b".repeat(64),
    status: "active",
    created_at: "2026-07-18T05:00:00.000Z",
    invalidated_at: null,
    ...change,
  };
}

export function entitlementRow(change: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000051",
    tenant_id: tenantId,
    billing_account_id: tenantId,
    subscription_id: "00000000-0000-4000-8000-000000000052",
    entitlement_version: "entitlement-1",
    status: "active",
    plan_code: "enterprise-test",
    plan_version: "plan-1",
    entitlements: {
      "worker.translation_runtime.concurrent": { enabled: true, limit: 2 },
      "worker.voice_agent_runtime.concurrent": { enabled: true, limit: 1 },
    },
    effective_from: "2026-07-18T04:00:00.000Z",
    effective_until: null,
    created_at: "2026-07-18T04:00:00.000Z",
    ...change,
  };
}

export function billingAccountRow(change: Record<string, unknown> = {}) {
  return {
    id: tenantId,
    tenant_id: tenantId,
    status: "active",
    currency: "CNY",
    billing_contact_subject_id: null,
    created_at: "2026-07-18T04:00:00.000Z",
    updated_at: "2026-07-18T04:00:00.000Z",
    version: "1",
    ...change,
  };
}

export function subscriptionRow(change: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000052",
    tenant_id: tenantId,
    billing_account_id: tenantId,
    plan_code: "enterprise-test",
    plan_version: "plan-1",
    status: "active",
    seats: "1",
    billing_cycle: "monthly",
    current_period_start: "2026-07-18T04:00:00.000Z",
    current_period_end: "2026-08-18T04:00:00.000Z",
    created_at: "2026-07-18T04:00:00.000Z",
    updated_at: "2026-07-18T04:00:00.000Z",
    version: "1",
    ...change,
  };
}
