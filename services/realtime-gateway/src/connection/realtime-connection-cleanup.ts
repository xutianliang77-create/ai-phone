import type { SessionEndReason,PublicAdmissionReceipt } from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import type { DisconnectFinalizerRegistry } from "../sessions/disconnect-finalizer-registry.js";
import {
  deleteSession,
  getSession,
  transitionStatus,
  recordPublicDisconnectCheckpoint,
} from "../sessions/session-manager.js";
import type { SessionSyncTracker } from "../sessions/session-sync-tracker.js";
import type { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";

interface RealtimeConnectionCleanupOptions {
  publicImmediateFinalization?:boolean;
  checkpointDisconnect?:()=>Promise<PublicAdmissionReceipt>;
  retainPublicRecovery?:()=>boolean;
  releaseRetainedRecovery?:()=>void;
  session: RealtimeSession;
  generation: number;
  finalizer: Pick<RealtimeSessionFinalizer, "flush" | "finalize">;
  provider: Pick<RealtimeProvider, "closeSession">;
  sessionSync: Pick<SessionSyncTracker, "drain">;
  disconnectFinalizers: DisconnectFinalizerRegistry;
  closeClient: () => void;
  onError: (stage: "provider" | "sync", error: unknown) => void;
}

export class RealtimeConnectionCleanup {
  private cleanupPromise?: Promise<void>;
  private retained=false;

  constructor(private readonly options: RealtimeConnectionCleanupOptions) {}

  run(reason: Extract<SessionEndReason, "connection_closed" | "connection_error">) {
    this.cleanupPromise ??= this.runOnce(reason);
    return this.cleanupPromise;
  }

  get retainedPublicRecovery() { return this.retained; }

  private async runOnce(
    reason: Extract<SessionEndReason, "connection_closed" | "connection_error">,
  ) {
    const { session, generation } = this.options;
    const current = getSession(session.id);
    const isCurrent = current === session &&
      current.connectionGeneration === generation;
    if(this.options.publicImmediateFinalization){
      const owns=()=>getSession(session.id)===session&&session.connectionGeneration===generation;
      try{if(owns()&&session.status!=="ended"){
        if(this.options.checkpointDisconnect){
          await this.options.finalizer.flush();
          if(!owns()){this.options.closeClient();return;}
          try{
            const receipt=await this.options.checkpointDisconnect();
            if(!owns()){this.options.closeClient();return;}
            if(!recordPublicDisconnectCheckpoint(session.id,generation,receipt))throw Error("public_disconnect_checkpoint_not_confirmed");
            if(this.options.retainPublicRecovery?.()){
              this.retained=true;
              this.scheduleDeferredFinalization(reason);
              await this.options.sessionSync.drain();
              this.options.closeClient();
              return;
            }
          }catch(error){this.options.onError("sync",error);}
          // No remaining resume allowance is not a reason to skip the original
          // stop/settlement attempt. Its own durable confirmation still applies.
        }
        // Retention/new-WebSocket assembly remains gated. A checkpoint alone
        // must not leave a model session running indefinitely after disconnect.
        if(owns())await this.options.finalizer.finalize(reason);
      }}
      catch(error){this.options.onError("sync",error);}
      if(owns())await this.bestEffort("provider",()=>this.options.provider.closeSession(session.id));
      await this.bestEffort("sync",()=>this.options.sessionSync.drain());
      if(owns())deleteSession(session.id,session);this.options.closeClient();return;
    }
    if (isCurrent && current.status !== "ended") {
      if (current.status === "active" || current.status === "paused") {
        current.reconnectStatus = current.status;
      }
      transitionStatus(session.id, "connecting");
      this.scheduleDeferredFinalization(reason);
    }
    await this.options.finalizer.flush();
    await this.bestEffort("provider", () =>
      this.options.provider.closeSession(session.id));
    await this.bestEffort("sync", () => this.options.sessionSync.drain());
    if (!isCurrent) return;
    if (session.status === "ended") {
      deleteSession(session.id, session);
      return;
    }
    this.options.closeClient();
  }

  scheduleDeferredFinalization(reason: SessionEndReason) {
    const { session } = this.options;
    let deadlineAt = session.disconnectDeadlineAt ??
      this.options.disconnectFinalizers.deadline(session.id);
    deadlineAt = this.options.disconnectFinalizers.schedule(session.id, async () => {
      const pending = getSession(session.id);
      if (
        pending !== session ||
        pending.status !== "connecting" ||
        pending.disconnectDeadlineAt !== deadlineAt
      ) return;
      await this.options.finalizer.finalize(reason);
      this.options.releaseRetainedRecovery?.();
      deleteSession(session.id, session);
      this.options.closeClient();
    }, deadlineAt);
    session.disconnectDeadlineAt = deadlineAt;
  }

  private async bestEffort(
    stage: "provider" | "sync",
    operation: () => Promise<void>,
  ) {
    try {
      await operation();
    } catch (error) {
      this.options.onError(stage, error);
    }
  }
}
