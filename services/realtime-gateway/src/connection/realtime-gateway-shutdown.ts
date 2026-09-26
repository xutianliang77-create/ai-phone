import type WebSocket from "ws";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { getSession } from "../sessions/session-manager.js";

type Client = Pick<WebSocket, "readyState" | "close" | "terminate">;
interface Control {
  owns(): boolean;
  stop(): Promise<void>;
  force(): Promise<void>;
  started?: boolean;
}

/** Only process shutdown uses this drain. Normal stop/recovery continues to
 * use the original finalizer, generation checks and durable event sink. */
export class RealtimeGatewayShutdown {
  private controls = new Map<Client, Control>();
  private initializing = new Set<Promise<void>>();
  private pending = new Set<Promise<void>>();
  private stopping = false;
  private failed = false;
  private shutdown?: Promise<boolean>;

  constructor(private readonly options: {
    clients(): Iterable<Client>;
    stopAccepting(): void;
    closeTransport(): Promise<void>;
    onError(error: unknown): void;
    timeoutMs?: number;
  }) {}

  track(client: Client, work: Promise<unknown>) {
    const pending = work.then(() => undefined).catch(error => {
      this.failed = true;
      this.options.onError(error);
      client.terminate();
    }).finally(() => this.initializing.delete(pending));
    this.initializing.add(pending);
  }

  add(client: Client, control: Control) {
    // A retained old socket must never stop a newer generation's Provider.
    for (const [oldClient, old] of this.controls) if (!old.owns()) this.controls.delete(oldClient);
    this.controls.set(client, control);
    if (this.stopping) this.start(control);
  }

  remove(client: Client) { this.controls.delete(client); }
  get isStopping() { return this.stopping; }

  stop() {
    this.shutdown ??= this.stopOnce();
    return this.shutdown;
  }

  private start(control: Control) {
    if (control.started) return;
    control.started = true;
    const pending = Promise.resolve().then(() => control.stop()).catch(error => {
      this.failed = true;
      this.options.onError(error);
    }).finally(() => this.pending.delete(pending));
    this.pending.add(pending);
  }

  private async stopOnce() {
    this.stopping = true;
    this.options.stopAccepting();
    for (const control of this.controls.values()) this.start(control);
    for (const client of this.options.clients()) {
      if (!this.controls.has(client) && client.readyState === 1) client.close(1012, "server_shutdown");
    }
    const drain = async () => {
      while (this.initializing.size || this.pending.size) {
        await Promise.all([...this.initializing, ...this.pending]);
      }
    };
    const completed = await bounded(drain(), this.options.timeoutMs ?? 10_000);
    if (!completed || this.failed) {
      this.failed = true;
      const forced = [...this.controls.values()].map(async control => {
        if (control.owns()) await control.force();
      });
      for (const client of this.options.clients()) client.terminate();
      await bounded(Promise.allSettled(forced), 1_000);
    }
    await this.options.closeTransport();
    return completed && !this.failed;
  }
}

async function bounded(work: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work.then(() => true), new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function registerRealtimeShutdown(
  shutdown: RealtimeGatewayShutdown, ws: WebSocket,
  options: {session: RealtimeSession; generation: number; provider: RealtimeProvider;
    beforeStop(): Promise<void>; endRealtimeSession(reason: "connection_closed"): Promise<void>;
    cleanupConnection(): Promise<void>},
) {
  const owns = () => getSession(options.session.id) === options.session &&
    options.session.connectionGeneration === options.generation;
  shutdown.add(ws, { owns,
    stop: async () => {
      try {
        if (owns()) await options.beforeStop();
        if (owns()) await options.endRealtimeSession("connection_closed");
      }
      finally { await options.cleanupConnection(); }
    },
    force: () => options.provider.closeSession(options.session.id),
  });
}
