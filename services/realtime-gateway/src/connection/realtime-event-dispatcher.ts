import type { ServerRealtimeEvent } from "@translation/contracts";
import type { SessionEventSink } from "../sessions/session-event-sink.js";
import { SessionSyncTracker } from "../sessions/session-sync-tracker.js";

interface RealtimeEventDispatcherOptions {
  sendClient: (event: ServerRealtimeEvent) => void;
  eventSink: Pick<SessionEventSink, "record" | "requiresConfirmation" | "drain">;
  afterSend: (event: ServerRealtimeEvent) => void;
  onSyncError: (event: ServerRealtimeEvent, error: unknown) => void;
}

export class RealtimeEventDispatcher {
  private readonly sync = new SessionSyncTracker();
  private confirmationFailure:Error|undefined;
  private terminalRequested=false;

  constructor(private readonly options: RealtimeEventDispatcherOptions) {}

  readonly send = (event: ServerRealtimeEvent) => {
    if(this.options.eventSink.requiresConfirmation){
      if(this.confirmationFailure)return;
      if(event.type==="session.ended")this.terminalRequested=true;
      const confirmedLifecycle=["session.started","session.paused","session.resumed","session.ended"].includes(event.type);
      const snapshot=structuredClone(event);
      if(!confirmedLifecycle)this.options.sendClient(snapshot);
      // Track a handled promise; drain exposes the failure rather than silently
      // converting it to successful public persistence/settlement.
      const operation=Promise.resolve().then(()=>this.options.eventSink.record(snapshot)).then(()=>{
        if(this.confirmationFailure)return;
        if(this.terminalRequested&&(snapshot.type==="session.started"||snapshot.type==="session.resumed"))return;
        if(confirmedLifecycle)this.options.sendClient(snapshot);
        this.options.afterSend(snapshot);
      }).catch(error=>{
        this.confirmationFailure??=new Error("public_session_sync_unconfirmed");
        this.options.onSyncError(snapshot,error);
      });
      this.sync.track(operation);
      return;
    }
    this.options.sendClient(event);
    const operation = this.options.eventSink.record(event).catch((error) => {
      this.options.onSyncError(event, error);
    });
    this.sync.track(operation);
    this.options.afterSend(event);
  };

  async drain() {
    await this.sync.drain();
    if(this.options.eventSink.requiresConfirmation){
      await this.options.eventSink.drain?.();
      if(this.confirmationFailure)throw this.confirmationFailure;
    }
  }
}
