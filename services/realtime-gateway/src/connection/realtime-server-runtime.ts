import { createServer } from "node:http";
import { loadEnv } from "../config/env.js";
import { handleGatewayHttpRequest } from "./gateway-health.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { createSessionEventSink } from "../sessions/session-event-sink.js";
import { createUsageBalanceClient } from "../usage/usage-balance-client.js";
import { DisconnectFinalizerRegistry } from
  "../sessions/disconnect-finalizer-registry.js";
import { RealtimeGatewayProtection } from
  "../security/realtime-gateway-protection.js";
import { createProtectedWebSocketEntry } from "./realtime-websocket-entry.js";
import { GatewayDependencyReadinessMonitor } from "./gateway-dependency-readiness.js";

export function createRealtimeServerRuntime() {
  const env = loadEnv();
  const protection = new RealtimeGatewayProtection(env, (error) => {
    realtimeLogger.warn({ error }, "Realtime public entry rate limiter unavailable");
  });
  void protection.start().then((ready) => {
    if (!ready) realtimeLogger.warn(
      { provider: env.publicRateLimitProvider },
      "Realtime public entry protection is not ready",
    );
  });
  const dependencyReadiness = new GatewayDependencyReadinessMonitor(env);
  void dependencyReadiness.start().then(() => {
    const readiness = dependencyReadiness.readiness();
    if (!readiness.sessionReady) realtimeLogger.warn(
      { issues: readiness.issues },
      "Realtime core dependencies are not ready",
    );
  });
  const httpServer = createServer((request, response) => {
    handleGatewayHttpRequest(
      request,
      response,
      env,
      protection.readiness(),
      dependencyReadiness.readiness(),
    );
  });
  const server = createProtectedWebSocketEntry({
    httpServer,
    env,
    protection,
    onUpgradeError: (error) => {
      realtimeLogger.warn({ error }, "Realtime websocket upgrade failed");
    },
  });
  const disconnectFinalizers = new DisconnectFinalizerRegistry(
    env.disconnectGraceMs,
    (error) => realtimeLogger.error(
      { error },
      "Deferred session finalization failed",
    ),
  );
  return {
    env,
    protection,
    dependencyReadiness,
    httpServer,
    server,
    sessionEventSink: createSessionEventSink(env),
    usageBalanceClient: createUsageBalanceClient(env),
    disconnectFinalizers,
  };
}

export function listenRealtimeServerRuntime(
  runtime: ReturnType<typeof createRealtimeServerRuntime>,
) {
  const { env, protection, dependencyReadiness, httpServer, server,
    disconnectFinalizers } = runtime;
  httpServer.listen(env.port, env.host, () => {
    realtimeLogger.info({ host: env.host, port: env.port },
      "Realtime gateway started");
  });
  httpServer.on("close", () => {
    void protection.close();
    dependencyReadiness.close();
    disconnectFinalizers.close();
    server.close();
  });
  return httpServer;
}
