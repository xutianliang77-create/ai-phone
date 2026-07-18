export interface CallRoomResourceLimits {
  guestTicketTtlSeconds: number;
  maxParticipants: number;
  maxSessionSeconds: number;
  emptyTimeoutSeconds: number;
  maxDataPacketBytes: number;
  maxEventsPerRequest: number;
  maxEventRequestsPerSecond: number;
  maxParticipantNameCharacters: number;
}

const specifications = {
  guestTicketTtlSeconds: spec("CALL_GUEST_TICKET_TTL_SECONDS", 300, 30, 900),
  maxParticipants: spec("CALL_ROOM_MAX_PARTICIPANTS", 3, 3, 8),
  maxSessionSeconds: spec("CALL_ROOM_MAX_SESSION_SECONDS", 3600, 60, 7200),
  emptyTimeoutSeconds: spec("CALL_ROOM_EMPTY_TIMEOUT_SECONDS", 300, 60, 900),
  maxDataPacketBytes: spec("CALL_ROOM_MAX_DATA_PACKET_BYTES", 12_288, 1024, 15_000),
  maxEventsPerRequest: spec("CALL_ROOM_MAX_EVENTS_PER_REQUEST", 20, 1, 50),
  maxEventRequestsPerSecond: spec(
    "CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND",
    40,
    1,
    100,
  ),
  maxParticipantNameCharacters: spec(
    "CALL_ROOM_MAX_PARTICIPANT_NAME_CHARACTERS",
    80,
    1,
    120,
  ),
} as const;

export function getCallRoomResourceLimits(): CallRoomResourceLimits {
  return Object.fromEntries(
    Object.entries(specifications).map(([key, value]) => [
      key,
      parseBoundedInteger(process.env[value.env], value),
    ]),
  ) as unknown as CallRoomResourceLimits;
}

export function callRoomResourceLimitIssues() {
  return Object.values(specifications).flatMap((value) => {
    const configured = process.env[value.env];
    if (configured === undefined || configured.length === 0) return [];
    return isBoundedInteger(configured, value)
      ? []
      : [`call room ${value.env} must be ${value.minimum}-${value.maximum}`];
  });
}

function spec(env: string, fallback: number, minimum: number, maximum: number) {
  return { env, fallback, minimum, maximum };
}

function parseBoundedInteger(value: string | undefined, limits: ReturnType<typeof spec>) {
  return value && isBoundedInteger(value, limits) ? Number(value) : limits.fallback;
}

function isBoundedInteger(value: string, limits: ReturnType<typeof spec>) {
  const parsed = Number(value);
  return Number.isInteger(parsed) &&
    parsed >= limits.minimum && parsed <= limits.maximum;
}
