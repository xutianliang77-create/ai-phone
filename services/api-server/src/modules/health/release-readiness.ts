import { getPaymentDeploymentReadiness } from "../billing/payment-readiness.js";
import { getPstnReadiness } from "../calls/pstn-readiness.js";
import { getCallRoomReadiness } from "../call-links/call-room-readiness.js";
import { getDiagnosticsDeploymentReadiness } from "../diagnostics/diagnostics-alerting.js";
import { getAccountDeploymentReadiness } from "../account/account-readiness.js";
import { getSmsDeploymentReadiness } from "../account/sms-provider.js";
import { getReleaseMaterialsReadiness } from "./release-materials-readiness.js";
import { getLiveKitDispatchReadiness } from "../worker-dispatches/livekit-dispatch-readiness.js";
import { getLiveKitEgressReadiness } from "../recordings/livekit-egress-readiness.js";
import { getPostgresProjectionReadiness } from "../../infrastructure/storage/postgres-projection-status.js";
import { getAgentAssistReadiness } from "../agent-calls/agent-assist-provider.js";
import { getAutonomousAgentReadiness } from "../agent-calls/autonomous-agent-policy.js";
import { getLiveKitIngressReadiness } from "../ingress/livekit-ingress-readiness.js";
import { getPlatformScaleReadiness } from "../../infrastructure/platform/platform-scale-readiness.js";
import { getPlatformTelemetryReadiness } from "../../infrastructure/observability/platform-telemetry.js";
import { getVoiceAgentRuntimeReadiness } from
  "../agent-calls/voice-agent-runtime-readiness.js";
import { getAgentConsultReadiness } from
  "../agent-calls/agent-consult-readiness.js";
import { getPublicEntryProtectionReadiness } from
  "../../infrastructure/security/public-entry-protection.js";
import { getAgentCallExecutionReadiness } from
  "../agent-calls/agent-call-execution-readiness.js";
import { getReleaseCapabilityProfileReadiness } from
  "./release-capability-profile.js";

export async function getReleaseReadiness() {
  const capabilityProfileReadiness = getReleaseCapabilityProfileReadiness();
  const fullRelease = capabilityProfileReadiness.profile === "commercial_full";
  const accountReadiness = getAccountDeploymentReadiness();
  const paymentReadiness = getPaymentDeploymentReadiness();
  const callRoomReadiness = getCallRoomReadiness();
  const pstnReadiness = getPstnReadiness();
  const smsReadiness = getSmsDeploymentReadiness();
  const diagnosticsReadiness = await getDiagnosticsDeploymentReadiness();
  const releaseMaterialsReadiness = getReleaseMaterialsReadiness();
  const workerDispatchReadiness = getLiveKitDispatchReadiness();
  const egressReadiness = getLiveKitEgressReadiness();
  const postgresProjectionReadiness = getPostgresProjectionReadiness();
  const agentAssistReadiness = getAgentAssistReadiness();
  const autonomousAgentReadiness = getAutonomousAgentReadiness();
  const ingressReadiness = getLiveKitIngressReadiness();
  const platformScaleReadiness = getPlatformScaleReadiness();
  const telemetryReadiness = getPlatformTelemetryReadiness();
  const voiceAgentRuntimeReadiness = getVoiceAgentRuntimeReadiness();
  const agentConsultReadiness = getAgentConsultReadiness();
  const publicEntryProtectionReadiness = getPublicEntryProtectionReadiness();
  const agentCallExecutionReadiness = getAgentCallExecutionReadiness();
  const issues = [
    ...capabilityProfileReadiness.issues,
    ...accountReadiness.issues,
    ...paymentReadiness.issues,
    ...callRoomReadiness.issues,
    ...pstnReadiness.issues,
    ...smsReadiness.issues,
    ...diagnosticsReadiness.issues,
    ...releaseMaterialsReadiness.issues,
    ...workerDispatchReadiness.issues,
    ...(fullRelease ? egressReadiness.issues : []),
    ...postgresProjectionReadiness.issues,
    ...(agentAssistReadiness.status === "disabled" ? [] : agentAssistReadiness.issues),
    ...(process.env.VOICE_AGENT_AUTONOMOUS_ENABLED === "true"
      ? [...autonomousAgentReadiness.issues, ...voiceAgentRuntimeReadiness.issues]
      : []),
    ...(agentConsultReadiness.enabled ? agentConsultReadiness.issues : []),
    ...(ingressReadiness.enabled ? ingressReadiness.issues : []),
    ...(platformScaleReadiness.enabled ? platformScaleReadiness.issues : []),
    ...(telemetryReadiness.required ? telemetryReadiness.issues : []),
    ...(publicEntryProtectionReadiness.provider === "redis"
      ? []
      : ["Release requires distributed Redis public entry protection"]),
    ...publicEntryProtectionReadiness.issues,
    ...(fullRelease ? agentCallExecutionReadiness.issues : []),
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    service: "api-server",
    capabilityProfileReadiness,
    accountReadiness,
    paymentReadiness,
    callRoomReadiness,
    pstnReadiness,
    smsReadiness,
    diagnosticsReadiness,
    releaseMaterialsReadiness,
    workerDispatchReadiness,
    egressReadiness,
    postgresProjectionReadiness,
    agentAssistReadiness,
    autonomousAgentReadiness,
    voiceAgentRuntimeReadiness,
    agentConsultReadiness,
    ingressReadiness,
    platformScaleReadiness,
    telemetryReadiness,
    publicEntryProtectionReadiness,
    agentCallExecutionReadiness,
    issues,
  };
}
