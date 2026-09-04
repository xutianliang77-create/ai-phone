import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import {
  recoverStaleRealtimeSessions,
  startStaleRealtimeSessionRecovery,
} from "./modules/sessions/stale-session-recovery.js";
import {
  recoverPendingCallRoomOutbox,
  startCallRoomOutboxRecovery,
} from "./modules/call-links/call-room-outbox-recovery.js";
import {
  recoverPendingVoiceIdentityDeletions,
  startVoiceIdentityDeletionRecovery,
} from "./modules/voice-identities/voice-identity-deletion-recovery-runtime.js";
import {
  recoverPendingLiveKitSipCompletions,
  startLiveKitSipReconciliationRecovery,
} from "./modules/call-links/livekit-sip-reconciliation-recovery.js";
import {
  recoverStaleWorkerDispatches,
  startWorkerDispatchRecovery,
} from "./modules/worker-dispatches/worker-dispatch-recovery.js";
import {
  recoverRecordingJobs,
  startRecordingRecovery,
} from "./modules/recordings/recording-recovery.js";
import { startPostgresProjectionWorker } from "./infrastructure/storage/postgres-projection-worker.js";
import {
  recoverExternalMediaSources,
  startIngressRecovery,
} from "./modules/ingress/ingress-recovery.js";
import { assertPlatformScaleStartup } from "./infrastructure/platform/platform-scale-readiness.js";
import { startRecordingArtifactRecovery } from "./modules/recordings/recording-artifact-recovery.js";
import { startAgentCallLeaseRecovery } from
  "./modules/agent-calls/agent-call-lease-recovery.js";
import { startPlatformTelemetry } from "./infrastructure/observability/platform-telemetry.js";
import {
  recoverAgentConsults,
  startAgentConsultRecovery,
} from "./modules/agent-calls/agent-consult-recovery.js";
import { initializeRepositoryRuntime } from
  "./infrastructure/storage/repository-runtime.js";
import {
  assertAgentWorkRunnerConfiguration,
  startAgentWorkRunner,
} from
  "./modules/agent-calls/agent-work-runner.js";
import {
  assertAgentDeliveryCoordinatorConfiguration,
  startAgentDeliveryCoordinator,
} from
  "./modules/agent-calls/agent-delivery-coordinator.js";
import {
  recoverPendingTranslationControls,
  startTranslationControlRecovery,
} from
  "./modules/call-links/translation-call-control-outbox.js";

const env = loadEnv();
assertAgentWorkRunnerConfiguration(env);
assertAgentDeliveryCoordinatorConfiguration(env);
const repositoryRuntime = await initializeRepositoryRuntime();
const stopTelemetry = await startPlatformTelemetry();
assertPlatformScaleStartup();
const recovery = await recoverStaleRealtimeSessions({
  graceSeconds: env.realtimeStaleSessionGraceSeconds,
});
const app = await buildApp();
const outboxRecovery = await recoverPendingCallRoomOutbox();
const translationControlRecovery = await recoverPendingTranslationControls();
const voiceIdentityRecovery = await recoverPendingVoiceIdentityDeletions();
const sipReconciliation = await recoverPendingLiveKitSipCompletions({
  graceSeconds: env.livekitSipReconciliationGraceSeconds,
});
const stopRecovery = startStaleRealtimeSessionRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  graceSeconds: env.realtimeStaleSessionGraceSeconds,
  onResult: (result) => {
    if (result.recoveredCount > 0) {
      app.log.warn({ recovery: result }, "Recovered stale realtime sessions");
    }
  },
  onError: (error) => app.log.error({ error }, "Stale session recovery failed"),
});
const stopOutboxRecovery = startCallRoomOutboxRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  onResult: (result) => {
    if (result.publishedSessionCount > 0) {
      app.log.info({ outboxRecovery: result }, "Published pending call events");
    }
  },
  onError: (error) => app.log.error({ error }, "Call outbox recovery failed"),
});
const stopTranslationControlRecovery = startTranslationControlRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  onResult: (result) => {
    if (result.delivered > 0 || result.failed > 0) {
      app.log.info({ translationControlRecovery: result },
        "Reconciled translation call controls");
    }
  },
  onError: (error) => app.log.error(
    { error },
    "Translation call control recovery failed",
  ),
});
const stopVoiceIdentityRecovery = startVoiceIdentityDeletionRecovery({
  intervalMs: 60_000,
  onError: (error) => app.log.error(
    { error },
    "Voice identity deletion recovery failed",
  ),
});
const stopSipReconciliation = startLiveKitSipReconciliationRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  graceSeconds: env.livekitSipReconciliationGraceSeconds,
  onResult: (result) => {
    if (result.recoveredCount > 0) {
      app.log.warn({ sipReconciliation: result }, "Reconciled unanswered SIP calls");
    }
  },
  onError: (error) => app.log.error({ error }, "SIP reconciliation failed"),
});
const stopWorkerDispatchRecovery = startWorkerDispatchRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  onResult: (result) => {
    if (result.recoveredCount > 0 || result.failedCount > 0) {
      app.log.info({ workerDispatchRecovery: result }, "Reconciled Worker dispatches");
    }
  },
  onError: (error) => app.log.error({ error }, "Worker dispatch recovery failed"),
});
const stopRecordingRecovery = startRecordingRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  onResult: (result) => {
    if (result.recoveredCount > 0 || result.failedCount > 0) {
      app.log.info({ recordingRecovery: result }, "Reconciled recording jobs");
    }
  },
  onError: (error) => app.log.error({ error }, "Recording recovery failed"),
});
const stopIngressRecovery = startIngressRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  onResult: (result) => {
    if (result.recoveredCount > 0 || result.failedCount > 0) {
      app.log.info({ ingressRecovery: result }, "Reconciled external media sources");
    }
  },
  onError: (error) => app.log.error({ error }, "Ingress recovery failed"),
});
const stopRecordingArtifactRecovery = startRecordingArtifactRecovery({
  onResult: (result) => {
    if (result.verifiedCount > 0 || result.deletedCount > 0 || result.failedCount > 0) {
      app.log.info({ recordingArtifacts: result }, "Reconciled recording artifacts");
    }
  },
  onError: (error) => app.log.error({ error }, "Recording artifact recovery failed"),
});
const stopAgentCallLeaseRecovery = startAgentCallLeaseRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  onResult: (result) => {
    if (result.recoveredCount > 0 || result.reconciliationExpiredCount > 0) {
      app.log.warn({ agentCallLeases: result }, "Agent call leases reconciled fail closed");
    }
  },
  onError: (error) => app.log.error({ error }, "Agent call lease recovery failed"),
});
const stopAgentConsultRecovery = startAgentConsultRecovery({
  intervalSeconds: env.realtimeStaleSessionSweepSeconds,
  onResult: (result) => {
    if (result.recoveredCount > 0 || result.failedCount > 0) {
      app.log.warn({ agentConsults: result }, "External operator consults reconciled");
    }
  },
  onError: (error) => app.log.error({ error }, "Agent consult recovery failed"),
});
let stopPostgresProjection: () => Promise<void> = async () => {};
let stopAgentWorkRunner: () => Promise<void> = async () => {};
let stopAgentDeliveryCoordinator: () => Promise<void> = async () => {};
app.addHook("onClose", async () => {
  stopRecovery();
  stopOutboxRecovery();
  stopTranslationControlRecovery();
  stopVoiceIdentityRecovery();
  stopSipReconciliation();
  stopWorkerDispatchRecovery();
  stopRecordingRecovery();
  stopIngressRecovery();
  stopRecordingArtifactRecovery();
  stopAgentCallLeaseRecovery();
  stopAgentConsultRecovery();
  await stopPostgresProjection();
  await stopAgentWorkRunner();
  await stopAgentDeliveryCoordinator();
  await repositoryRuntime.close();
  await stopTelemetry();
});

let shutdownStarted = false;
const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  app.log.info({ signal }, "API shutdown started");
  try {
    await app.close();
    app.log.info({ signal }, "API shutdown completed");
  } catch (error) {
    app.log.error({ error, signal }, "API shutdown failed");
    process.exitCode = 1;
  }
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

if (recovery.recoveredCount > 0) {
  app.log.warn({ recovery }, "Recovered stale realtime sessions");
}
if (outboxRecovery.publishedSessionCount > 0) {
  app.log.info({ outboxRecovery }, "Published pending call events");
}
if (translationControlRecovery.delivered > 0 ||
  translationControlRecovery.failed > 0) {
  app.log.info({ translationControlRecovery },
    "Reconciled translation call controls");
}
if (voiceIdentityRecovery.deletedCount > 0) {
  app.log.warn(
    { voiceIdentityRecovery },
    "Recovered pending voice identity deletions",
  );
}
if (sipReconciliation.recoveredCount > 0) {
  app.log.warn({ sipReconciliation }, "Reconciled unanswered SIP calls");
}
await app.listen({ port: env.apiPort, host: env.apiHost });
stopPostgresProjection = await startPostgresProjectionWorker({
  onError: (error, eventId) => app.log.error(
    { error, eventId },
    "PostgreSQL projection failed",
  ),
});
stopAgentWorkRunner = startAgentWorkRunner({
  env,
  onResult: (result) => {
    if (result.claimed > 0 || result.converged > 0) {
      app.log.info({ agentWork: result }, "Agent Work runner cycle completed");
    }
  },
  onError: (error) => app.log.error({ error }, "Agent Work runner failed"),
});
stopAgentDeliveryCoordinator = startAgentDeliveryCoordinator({
  env,
  onResult: (result) => {
    if (result.materialized > 0 || result.claimed > 0 ||
        result.converged > 0) {
      app.log.info({ agentDelivery: result },
        "Agent delivery coordinator cycle completed");
    }
  },
  onError: (error) => app.log.error(
    { error },
    "Agent delivery coordinator failed",
  ),
});
const agentConsultRecovery = await recoverAgentConsults();
if (agentConsultRecovery.recoveredCount > 0 || agentConsultRecovery.failedCount > 0) {
  app.log.warn({ agentConsultRecovery }, "External operator consults reconciled");
}
const ingressRecovery = await recoverExternalMediaSources();
if (ingressRecovery.recoveredCount > 0 || ingressRecovery.failedCount > 0) {
  app.log.info({ ingressRecovery }, "Reconciled external media sources");
}
const recordingRecovery = await recoverRecordingJobs();
if (recordingRecovery.recoveredCount > 0 || recordingRecovery.failedCount > 0) {
  app.log.info({ recordingRecovery }, "Reconciled recording jobs");
}
const workerDispatchRecovery = await recoverStaleWorkerDispatches();
if (workerDispatchRecovery.recoveredCount > 0 || workerDispatchRecovery.failedCount > 0) {
  app.log.info({ workerDispatchRecovery }, "Reconciled Worker dispatches");
}
