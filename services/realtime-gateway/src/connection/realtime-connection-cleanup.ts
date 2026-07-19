import type { SessionEndReason } from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import type { DisconnectFinalizerRegistry } from "../sessions/disconnect-finalizer-registry.js";
import {
  deleteSession,
  getSession,
  transitionStatus,
} from "../sessions/session-manager.js";
import type { SessionSyncTracker } from "../sessions/session-sync-tracker.js";
import type { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";

interface RealtimeConnectionCleanupOptions {
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

  constructor(private readonly options: RealtimeConnectionCleanupOptions) {}

  run(reason: Extract<SessionEndReason, "connection_closed" | "connection_error">) {
    this.cleanupPromise ??= this.runOnce(reason);
    return this.cleanupPromise;
  }

  private async runOnce(
    reason: Extract<SessionEndReason, "connection_closed" | "connection_error">,
  ) {
    const { session, generation } = this.options;
    const current = getSession(session.id);
    const isCurrent = current === session &&
      current.connectionGeneration === generation;
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
