export type AgentResponseState =
  | "initializing"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export class AgentResponseStartWatchdog {
  private timer?: NodeJS.Timeout;

  constructor(private readonly options: {
    timeoutMs: number;
    onTimeout: () => void | Promise<void>;
    onError?: (error: unknown) => void;
  }) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error("Agent response-start watchdog timeout must be positive");
    }
  }

  observe(state: AgentResponseState) {
    if (state === "thinking") {
      this.arm();
      return;
    }
    this.cancel();
  }

  close() {
    this.cancel();
  }

  private arm() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void Promise.resolve(this.options.onTimeout()).catch(
        this.options.onError ?? (() => undefined),
      );
    }, this.options.timeoutMs);
    this.timer.unref();
  }

  private cancel() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
