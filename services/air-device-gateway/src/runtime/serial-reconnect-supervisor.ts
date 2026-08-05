interface SerialReconnectTarget {
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
}

export class SerialReconnectSupervisor {
  private state: "idle" | "recovering" | "stopped" = "idle";
  private timer?: ReturnType<typeof setTimeout>;
  private current?: Promise<void>;
  private lastReason?: string;
  private readonly counters = {
    disconnects: 0,
    attempts: 0,
    failures: 0,
    recoveries: 0,
  };
  private readonly retryDelayMs: number;

  constructor(
    private readonly target: SerialReconnectTarget,
    options: { retryDelayMs?: number } = {},
  ) {
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    if (!Number.isInteger(this.retryDelayMs) || this.retryDelayMs < 1 ||
      this.retryDelayMs > 60_000) {
      throw new Error("Serial reconnect retryDelayMs must be 1-60000");
    }
  }

  recover(reason: string) {
    if (this.state === "stopped") return;
    this.counters.disconnects += 1;
    this.lastReason = reason;
    if (this.state === "recovering") return;
    this.state = "recovering";
    this.schedule(0);
  }

  async stop() {
    this.state = "stopped";
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.current?.catch(() => undefined);
  }

  metrics() {
    return {
      state: this.state,
      ...this.counters,
      ...(this.lastReason ? { lastReason: this.lastReason } : {}),
    };
  }

  private schedule(delayMs: number) {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.attempt();
    }, delayMs);
    this.timer.unref();
  }

  private async attempt() {
    if (this.state !== "recovering") return;
    this.counters.attempts += 1;
    const current = this.reopen();
    this.current = current;
    try {
      await current;
      if (this.state === "recovering") {
        this.counters.recoveries += 1;
        this.state = "idle";
      } else if (this.target.isOpen) {
        await this.target.close().catch(() => undefined);
      }
    } catch {
      this.counters.failures += 1;
      if (this.state === "recovering") this.schedule(this.retryDelayMs);
    } finally {
      if (this.current === current) this.current = undefined;
    }
  }

  private async reopen() {
    await this.target.close().catch(() => undefined);
    if (this.state !== "recovering") return;
    await this.target.open();
  }
}
