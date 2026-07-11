export interface ProviderEventDeduper {
  runOnce<T>(
    eventId: string | undefined,
    handler: () => Promise<T>,
  ): Promise<{ duplicate: boolean; result?: T }>;
}

export class InMemoryProviderEventDeduper implements ProviderEventDeduper {
  private readonly completed = new Map<string, true>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly maxCompletedEvents = 5000) {}

  async runOnce<T>(eventId: string | undefined, handler: () => Promise<T>) {
    const id = eventId?.trim();
    if (!id) return { duplicate: false, result: await handler() };
    if (this.completed.has(id)) return { duplicate: true };

    const pending = this.inFlight.get(id);
    if (pending) {
      await pending;
      return { duplicate: true };
    }

    const promise = handler();
    this.inFlight.set(id, promise);
    try {
      const result = await promise;
      this.markCompleted(id);
      return { duplicate: false, result };
    } finally {
      this.inFlight.delete(id);
    }
  }

  private markCompleted(id: string) {
    this.completed.set(id, true);
    while (this.completed.size > this.maxCompletedEvents) {
      const oldest = this.completed.keys().next().value;
      if (!oldest) return;
      this.completed.delete(oldest);
    }
  }
}
