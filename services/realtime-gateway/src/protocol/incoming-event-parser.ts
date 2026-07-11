import type { ClientRealtimeEvent } from "@translation/contracts";

export function parseIncomingEvent(raw: string): ClientRealtimeEvent | null {
  try {
    const event = JSON.parse(raw) as ClientRealtimeEvent;
    if (!event || typeof event.type !== "string") return null;
    return event;
  } catch {
    return null;
  }
}
