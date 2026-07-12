import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import {
  recoverStaleRealtimeSessions,
  startStaleRealtimeSessionRecovery,
} from "./modules/sessions/stale-session-recovery.js";

const env = loadEnv();
const recovery = await recoverStaleRealtimeSessions({
  graceSeconds: env.realtimeStaleSessionGraceSeconds,
});
const app = await buildApp();
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
app.addHook("onClose", async () => { stopRecovery(); });

if (recovery.recoveredCount > 0) {
  app.log.warn({ recovery }, "Recovered stale realtime sessions");
}

await app.listen({ port: env.apiPort, host: "0.0.0.0" });
