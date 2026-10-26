import { verifyGatewayStopReceipt } from "@translation/platform-security";
import { loadEnv } from "../../config/env.js";
import type { SessionRecord } from "../sessions/session-record.js";

export function formalRealtimeRelease() {
  return process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL === "app_store" || (process.env.AUTH_PROVIDER === "apple" || process.env.V10_CONTROL_AUTHORITY === "cloudflare");
}

export function verifiedGatewaySettlement(session: SessionRecord, supplied: unknown) {
  const receipt = typeof supplied === "string" ? supplied : session.gatewayFinalizationReceipt;
  const verified = verifyGatewayStopReceipt(receipt, loadEnv().realtimeTokenSecret,
    { sessionId: session.id, userId: session.userId });
  return verified && typeof receipt === "string" ? { receipt, billableSeconds: verified.billableSeconds } : null;
}
