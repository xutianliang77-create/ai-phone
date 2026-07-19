import type { IncomingMessage } from "node:http";

export const realtimeProtocol = "ai-phone.realtime.v1";
const tokenProtocolPrefix = "ai-phone.token.";

export function realtimeTokenProtocol(token: string) {
  return `${tokenProtocolPrefix}${token}`;
}

export function extractRealtimeConnectionToken(
  request: Pick<IncomingMessage, "headers" | "url">,
  allowQueryToken: boolean,
) {
  const protocolToken = tokenFromProtocols(
    request.headers["sec-websocket-protocol"],
  );
  if (protocolToken) return protocolToken;
  if (!allowQueryToken) return null;
  const url = new URL(request.url ?? "", "http://127.0.0.1");
  return url.searchParams.get("token");
}

function tokenFromProtocols(value: string | string[] | undefined) {
  const protocols = Array.isArray(value) ? value.join(",") : value;
  if (!protocols) return null;
  for (const protocol of protocols.split(",")) {
    const trimmed = protocol.trim();
    if (trimmed.startsWith(tokenProtocolPrefix)) {
      const token = trimmed.slice(tokenProtocolPrefix.length);
      if (token.length > 0 && token.length <= 4096) return token;
    }
  }
  return null;
}
