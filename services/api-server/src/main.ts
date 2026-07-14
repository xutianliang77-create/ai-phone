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

const env = loadEnv();
const recovery = await recoverStaleRealtimeSessions({
  graceSeconds: env.realtimeStaleSessionGraceSeconds,
});
const app = await buildApp();
const outboxRecovery = await recoverPendingCallRoomOutbox();
const voiceIdentityRecovery = await recoverPendingVoiceIdentityDeletions();
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
app.addHook("onClose", async () => {
  stopRecovery();
  stopOutboxRecovery();
  stopVoiceIdentityRecovery();
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

await app.listen({ port: env.apiPort, host: "0.0.0.0" });
