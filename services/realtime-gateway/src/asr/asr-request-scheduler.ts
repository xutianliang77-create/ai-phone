export class AsrRequestScheduler {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(sessionId: string, request: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(request);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(sessionId, tail);
    void tail.finally(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId);
    });
    return result;
  }
}
