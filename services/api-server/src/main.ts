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
} from "./modules/voice-identities/voice-identity-deletion-recovery.js";
import {
  createEnvironmentTenantLifecycleExecutor,
} from "./modules/enterprise/enterprise-tenant-lifecycle-executor.js";
import {
  recoverPendingEnterpriseTenantLifecycleJobs,
  startEnterpriseTenantLifecycleRecovery,
} from "./modules/enterprise/enterprise-tenant-lifecycle-processor.js";
import {
  runEnterprisePostgresStartupGate,
} from "./infrastructure/postgres/enterprise-postgres-startup-gate.js";

const enterprisePostgresStartup = await runEnterprisePostgresStartupGate();
const env = loadEnv();
const recovery = await recoverStaleRealtimeSessions({
  graceSeconds: env.realtimeStaleSessionGraceSeconds,
});
const tenantLifecycleExecutor = createEnvironmentTenantLifecycleExecutor();
const app = await buildApp({ tenantLifecycleExecutor });
if (enterprisePostgresStartup.status === "verified") {
  app.log.info(
    { enterprisePostgresStartup },
    "Enterprise PostgreSQL startup gate verified",
  );
}
const outboxRecovery = await recoverPendingCallRoomOutbox();
const voiceIdentityRecovery = await recoverPendingVoiceIdentityDeletions();
const tenantLifecycleRecovery =
  await recoverPendingEnterpriseTenantLifecycleJobs(tenantLifecycleExecutor);
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
const stopVoiceIdentityRecovery = startVoiceIdentityDeletionRecovery({
  intervalMs: 60_000,
  onError: (error) => app.log.error(
    { error },
    "Voice identity deletion recovery failed",
  ),
});
const stopTenantLifecycleRecovery = startEnterpriseTenantLifecycleRecovery({
  executor: tenantLifecycleExecutor,
  onResult: (result) => {
    if (result.completedCount > 0 || result.failedCount > 0) {
      app.log.info(
        { tenantLifecycleRecovery: result },
        "Processed tenant lifecycle jobs",
      );
    }
  },
  onError: (error) => app.log.error(
    { error },
    "Tenant lifecycle recovery failed",
  ),
});
app.addHook("onClose", async () => {
  stopRecovery();
  stopOutboxRecovery();
  stopVoiceIdentityRecovery();
  stopTenantLifecycleRecovery();
});

if (recovery.recoveredCount > 0) {
  app.log.warn({ recovery }, "Recovered stale realtime sessions");
}
if (outboxRecovery.publishedSessionCount > 0) {
  app.log.info({ outboxRecovery }, "Published pending call events");
}
if (voiceIdentityRecovery.deletedCount > 0) {
  app.log.warn(
    { voiceIdentityRecovery },
    "Recovered pending voice identity deletions",
  );
}
if (
  tenantLifecycleRecovery.completedCount > 0 ||
  tenantLifecycleRecovery.failedCount > 0
) {
  app.log.info(
    { tenantLifecycleRecovery },
    "Recovered tenant lifecycle jobs",
  );
}

await app.listen({ port: env.apiPort, host: "0.0.0.0" });
