import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { recoverStaleRealtimeSessions } from "./modules/sessions/stale-session-recovery.js";

const env = loadEnv();
const recovery = recoverStaleRealtimeSessions({
  graceSeconds: env.realtimeStaleSessionGraceSeconds,
});
const app = await buildApp();

if (recovery.recoveredCount > 0) {
  app.log.warn({ recovery }, "Recovered stale realtime sessions");
}

await app.listen({ port: env.apiPort, host: "0.0.0.0" });
