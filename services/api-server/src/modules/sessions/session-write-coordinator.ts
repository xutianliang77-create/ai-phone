const writes = new Map<string, Promise<unknown>>();

export async function withSessionWriteLock<T>(
  sessionId: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const previous = writes.get(sessionId) ?? Promise.resolve();
  const running = previous.catch(() => undefined).then(operation);
  writes.set(sessionId, running);
  try {
    return await running;
  } finally {
    if (writes.get(sessionId) === running) writes.delete(sessionId);
  }
}
