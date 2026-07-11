import type { ServerRealtimeEvent } from "@translation/contracts";
import type { SessionEventSink } from "../sessions/session-event-sink.js";
import { SessionSyncTracker } from "../sessions/session-sync-tracker.js";

interface RealtimeEventDispatcherOptions {
  sendClient: (event: ServerRealtimeEvent) => void;
  eventSink: Pick<SessionEventSink, "record">;
  afterSend: (event: ServerRealtimeEvent) => void;
  onSyncError: (event: ServerRealtimeEvent, error: unknown) => void;
}

export class RealtimeEventDispatcher {
  private readonly sync = new SessionSyncTracker();

  constructor(private readonly options: RealtimeEventDispatcherOptions) {}

  readonly send = (event: ServerRealtimeEvent) => {
    this.options.sendClient(event);
    const operation = this.options.eventSink.record(event).catch((error) => {
      this.options.onSyncError(event, error);
    });
    this.sync.track(operation);
    this.options.afterSend(event);
  };

  drain() {
    return this.sync.drain();
  }
}
