export class DisconnectFinalizerRegistry {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly graceMs: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  schedule(sessionId: string, finalize: () => Promise<void>) {
    this.cancel(sessionId);
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void finalize().catch(this.onError);
    }, this.graceMs);
    this.timers.set(sessionId, timer);
  }

  cancel(sessionId: string) {
    const timer = this.timers.get(sessionId);
    if (!timer) return false;
    clearTimeout(timer);
    this.timers.delete(sessionId);
    return true;
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
