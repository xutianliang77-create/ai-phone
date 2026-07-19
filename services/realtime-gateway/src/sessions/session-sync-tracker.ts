export class SessionSyncTracker {
  private readonly pending = new Set<Promise<void>>();

  track(operation: Promise<void>) {
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation));
  }

  async drain() {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }
}
