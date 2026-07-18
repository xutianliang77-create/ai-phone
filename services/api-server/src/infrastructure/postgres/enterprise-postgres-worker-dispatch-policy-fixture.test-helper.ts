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
