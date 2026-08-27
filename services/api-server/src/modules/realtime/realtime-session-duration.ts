const DEFAULT_MAX_SESSION_SECONDS = 1800;
const MIN_MAX_SESSION_SECONDS = 60;
const MAX_MAX_SESSION_SECONDS = 14_400;

export function realtimeMaxSessionSeconds(
  value = process.env.REALTIME_MAX_SESSION_SECONDS,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
      parsed >= MIN_MAX_SESSION_SECONDS &&
      parsed <= MAX_MAX_SESSION_SECONDS
    ? parsed
    : DEFAULT_MAX_SESSION_SECONDS;
}
