export class KeyedAsyncQueue {
  private readonly queues = new Map<string, Promise<void>>();

  enqueue(key: string, operation: () => Promise<void>) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(key, current);
    void current.finally(() => {
      if (this.queues.get(key) === current) this.queues.delete(key);
    }).catch(() => undefined);
    return current;
  }

  async drain(key: string) {
    await this.queues.get(key);
  }
}
