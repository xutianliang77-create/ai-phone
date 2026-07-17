import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "./json-store.js";

export function nextPostgresProjectionEvents(limit: number, now = new Date()) {
  return getStoreSnapshot().postgresProjectionEvents
    .filter((event) => Date.parse(event.nextAttemptAt) <= now.getTime())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, limit);
}

export function acknowledgePostgresProjectionEvent(eventId: string) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const before = store.postgresProjectionEvents.length;
    store.postgresProjectionEvents = store.postgresProjectionEvents.filter(
      (event) => event.id !== eventId,
    );
    if (store.postgresProjectionEvents.length === before) return false;
    persistStoreSnapshot();
    return true;
  });
}

export function failPostgresProjectionEvent(
  eventId: string,
  error: unknown,
  now = new Date(),
) {
  return runStoreTransaction(() => {
    const event = getStoreSnapshot().postgresProjectionEvents.find(
      (item) => item.id === eventId,
    );
    if (!event) return null;
    event.attempts += 1;
    event.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 160);
    event.updatedAt = now.toISOString();
    const delaySeconds = Math.min(300, 2 ** Math.min(8, event.attempts));
    event.nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
    persistStoreSnapshot();
    return event;
  });
}
