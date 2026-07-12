export class DisconnectFinalizerRegistry {
  private readonly entries = new Map<string, {
    timer: ReturnType<typeof setTimeout>;
    deadlineAt: number;
  }>();

  constructor(
    private readonly graceMs: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  schedule(
    sessionId: string,
    finalize: () => Promise<void>,
    deadlineAt = this.entries.get(sessionId)?.deadlineAt ?? Date.now() + this.graceMs,
  ) {
    const existing = this.entries.get(sessionId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.entries.delete(sessionId);
      void finalize().catch(this.onError);
    }, Math.max(0, deadlineAt - Date.now()));
    this.entries.set(sessionId, { timer, deadlineAt });
    return deadlineAt;
  }

  deadline(sessionId: string) {
    return this.entries.get(sessionId)?.deadlineAt;
  }

  cancel(sessionId: string) {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.entries.delete(sessionId);
    return true;
  }

  close() {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
  }
}
