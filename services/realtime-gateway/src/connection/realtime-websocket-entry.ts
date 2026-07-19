import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { realtimeProtocol } from "../auth/realtime-connection-token.js";
import type { RealtimeEnv } from "../config/env.js";
import type { RealtimeGatewayProtection } from
  "../security/realtime-gateway-protection.js";

interface ProtectedWebSocketEntryOptions {
  httpServer: Server;
  env: RealtimeEnv;
  protection: RealtimeGatewayProtection;
  onUpgradeError: (error: unknown) => void;
}

export function createProtectedWebSocketEntry(
  options: ProtectedWebSocketEntryOptions,
) {
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: options.env.maxPayloadBytes,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has(realtimeProtocol) ? realtimeProtocol : false,
  });
  options.httpServer.on("upgrade", (request, socket, head) => {
    void handleUpgrade().catch((error) => {
      options.onUpgradeError(error);
      rejectUpgrade(socket, 503, "upgrade_unavailable");
    });

    async function handleUpgrade() {
      if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/realtime") {
        rejectUpgrade(socket, 404, "not_found");
        return;
      }
      const reservation = await options.protection.reserve(request);
      if (!reservation.ok) {
        rejectUpgrade(
          socket,
          reservation.statusCode,
          reservation.reason,
          reservation.retryAfterSeconds,
        );
        return;
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        options.protection.release(reservation.clientIp);
      };
      socket.once("close", release);
      try {
        server.handleUpgrade(request, socket, head, (ws) => {
          ws.once("close", release);
          server.emit("connection", ws, request);
        });
      } catch (error) {
        release();
        throw error;
      }
    }
  });
  return server;
}

function rejectUpgrade(
  socket: Duplex,
  statusCode: number,
  reason: string,
  retryAfterSeconds?: number,
) {
  if (socket.destroyed) return;
  const statusText = statusCode === 403 ? "Forbidden"
    : statusCode === 404 ? "Not Found"
    : statusCode === 429 ? "Too Many Requests"
    : "Service Unavailable";
  const body = JSON.stringify({ error: { code: reason, message: statusText } });
  socket.end([
    `HTTP/1.1 ${statusCode} ${statusText}`,
    "Connection: close",
    "Content-Type: application/json",
    `Content-Length: ${Buffer.byteLength(body)}`,
    ...(retryAfterSeconds ? [`Retry-After: ${retryAfterSeconds}`] : []),
    "",
    body,
  ].join("\r\n"));
}
