export function endpointModeForRealtimeMode(mode: string | undefined) {
  return mode === "meeting" || mode === "classroom"
    ? "listening" as const
    : "conversation" as const;
}
