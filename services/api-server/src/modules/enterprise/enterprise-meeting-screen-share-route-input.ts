import { createHash } from "node:crypto";

export function parseScreenShareAcquire(value: unknown) {
  const body = object(value);
  if (!body || !onlyKeys(body, [
    "sourceType", "includesSystemAudio", "qualityMode", "expectedMeetingVersion",
  ]) || !["screen", "window", "tab"].includes(String(body.sourceType)) ||
    typeof body.includesSystemAudio !== "boolean" ||
    !["auto", "smooth", "high"].includes(String(body.qualityMode)) ||
    !version(body.expectedMeetingVersion)) return null;
  return {
    sourceType: body.sourceType as "screen" | "window" | "tab",
    includesSystemAudio: body.includesSystemAudio,
    qualityMode: body.qualityMode as "auto" | "smooth" | "high",
    expectedMeetingVersion: Number(body.expectedMeetingVersion),
  };
}

export function parseScreenShareCommand(
  value: unknown,
  command: "pause" | "resume" | "renew" | "stop" | "force_stop",
) {
  const body = object(value);
  const allowed = command === "renew" ? ["expectedVersion", "trackSid"]
    : ["expectedVersion"];
  if (!body || !onlyKeys(body, allowed) || !version(body.expectedVersion)) return null;
  const trackSid = body.trackSid;
  if (trackSid !== undefined && (command !== "renew" ||
    typeof trackSid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(trackSid))) {
    return null;
  }
  return {
    expectedVersion: Number(body.expectedVersion),
    ...(trackSid ? { trackSid } : {}),
  };
}

export function screenShareRequestHash(input: {
  actorUserId: string;
  meetingId: string;
  shareId?: string;
  command: "acquire" | "pause" | "resume" | "renew" | "stop" | "force_stop";
  body: unknown;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function version(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
