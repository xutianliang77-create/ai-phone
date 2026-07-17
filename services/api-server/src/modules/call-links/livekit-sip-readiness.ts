import { getLiveKitRoomConfig } from "./call-room-readiness.js";
import { getPstnReadiness } from "../calls/pstn-readiness.js";

export interface LiveKitSipConfig {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  outboundTrunkId: string;
  ringingTimeoutSeconds: number;
  maxCallDurationSeconds: number;
  requestTimeoutSeconds: number;
  inbound?: {
    trunkId: string;
    displayNumber: string;
  };
}

export function getLiveKitSipReadiness() {
  const provider = (process.env.PSTN_PROVIDER ?? "").trim();
  const room = getLiveKitRoomConfig();
  const pstn = getPstnReadiness();
  const issues = [
    ...(provider === "livekit_sip"
      ? []
      : ["livekit sip requires PSTN_PROVIDER=livekit_sip"]),
    ...(pstn.status === "ready" ? [] : pstn.issues),
    ...boundedIntegerIssues(
      "LIVEKIT_SIP_RINGING_TIMEOUT_SECONDS",
      process.env.LIVEKIT_SIP_RINGING_TIMEOUT_SECONDS,
      10,
      120,
    ),
    ...boundedIntegerIssues(
      "LIVEKIT_SIP_REQUEST_TIMEOUT_SECONDS",
      process.env.LIVEKIT_SIP_REQUEST_TIMEOUT_SECONDS,
      2,
      30,
    ),
    ...boundedIntegerIssues(
      "LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS",
      process.env.LIVEKIT_SIP_RECONCILIATION_GRACE_SECONDS,
      5,
      300,
    ),
    ...maxCallDurationIssues(),
    ...inboundIssues(),
    ...(room.ok ? [] : room.issues),
  ];
  return {
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    provider,
    trunk: process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID
      ? "configured" as const
      : "configuration_required" as const,
    issues,
  };
}

export function getLiveKitSipConfig():
  | { ok: true; config: LiveKitSipConfig }
  | { ok: false; issues: string[] } {
  const readiness = getLiveKitSipReadiness();
  const room = getLiveKitRoomConfig();
  if (readiness.status !== "ready" || !room.ok) {
    return { ok: false, issues: readiness.issues };
  }
  return {
    ok: true,
    config: {
      livekitUrl: room.config.livekitUrl,
      apiKey: room.config.apiKey,
      apiSecret: room.config.apiSecret,
      outboundTrunkId: process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID!,
      ringingTimeoutSeconds: boundedInteger(
        process.env.LIVEKIT_SIP_RINGING_TIMEOUT_SECONDS,
        45,
      ),
      requestTimeoutSeconds: boundedInteger(
        process.env.LIVEKIT_SIP_REQUEST_TIMEOUT_SECONDS,
        10,
      ),
      maxCallDurationSeconds: Number(process.env.PSTN_MAX_CALL_MINUTES) * 60,
      ...(inboundConfig() ? { inbound: inboundConfig()! } : {}),
    },
  };
}

function inboundIssues() {
  if (process.env.LIVEKIT_SIP_INBOUND_ENABLED !== "true") return [];
  const issues: string[] = [];
  if (!/^ST_[A-Za-z0-9_-]{6,}$/.test(
    process.env.LIVEKIT_SIP_INBOUND_TRUNK_ID ?? "",
  )) issues.push("livekit sip inbound trunk id is invalid");
  if (process.env.LIVEKIT_SIP_INBOUND_DEDICATED_TRUNK !== "true") {
    issues.push("livekit sip inbound requires a dedicated trunk");
  }
  if (!/^\+[1-9]\d{7,14}$/.test(
    process.env.LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER ?? "",
  )) issues.push("livekit sip inbound display number must be E.164");
  return issues;
}

function inboundConfig() {
  return process.env.LIVEKIT_SIP_INBOUND_ENABLED === "true" &&
      inboundIssues().length === 0
    ? {
      trunkId: process.env.LIVEKIT_SIP_INBOUND_TRUNK_ID!,
      displayNumber: process.env.LIVEKIT_SIP_INBOUND_DISPLAY_NUMBER!,
    }
    : null;
}

function maxCallDurationIssues() {
  const value = Number(process.env.PSTN_MAX_CALL_MINUTES);
  return Number.isInteger(value) && value > 0 && value <= 120
    ? []
    : ["livekit sip PSTN_MAX_CALL_MINUTES must be 1-120"];
}

function boundedIntegerIssues(
  name: string,
  value: string | undefined,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value.length === 0) return [];
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? []
    : [`livekit sip ${name} must be ${minimum}-${maximum}`];
}

function boundedInteger(value: string | undefined, fallback: number) {
  return value ? Number(value) : fallback;
}
