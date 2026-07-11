import type { RealtimeError, ServerRealtimeEvent } from "@translation/contracts";

export function serializeEvent(event: ServerRealtimeEvent) {
  return JSON.stringify(event);
}

export function buildError(
  code: RealtimeError["code"],
  message: string,
  details: Omit<Partial<RealtimeError>, "type" | "code" | "message"> = {},
): RealtimeError {
  return {
    type: "error",
    code,
    message,
    ...details,
  };
}
