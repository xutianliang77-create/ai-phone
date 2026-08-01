import { getCallRoomResourceLimits } from "./call-room-resource-limits.js";

export function parseCallRoomParticipantRole(value: unknown) {
  if (value === undefined || value === "guest") return "guest" as const;
  return value === "host" ? ("host" as const) : null;
}

export function parseCallRoomParticipantName(value: unknown):
  | { ok: true; value?: string }
  | { ok: false } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string") return { ok: false };
  const normalized = value.trim();
  return Array.from(normalized).length <=
      getCallRoomResourceLimits().maxParticipantNameCharacters
    ? { ok: true, ...(normalized ? { value: normalized } : {}) }
    : { ok: false };
}
