import { createHash } from "node:crypto";
import type { AirDeviceCarrierEventRequest } from "@translation/contracts";

interface EventWithId {
  eventId: string;
}

export interface AirGatewayEventOutbox<T extends EventWithId> {
  load(): Promise<T[]>;
  put(event: T): Promise<void>;
  remove(eventId: string): Promise<void>;
}

interface PendingEvent<T extends EventWithId> {
  event: T;
  signature: string;
}

export class AirGatewayCarrierEventDispatcher<
  T extends EventWithId = AirDeviceCarrierEventRequest,
> {
  private readonly pending = new Map<string, PendingEvent<T>>();
  private readonly maxPendingEvents: number;
  private readonly retryDelayMs: number;
  private drainPromise: Promise<void> = Promise.resolve();
  private draining = false;
  private cancelRetry?: () => void;
  private initialized: boolean;
  private initializing?: Promise<void>;
  private enqueueTail = Promise.resolve();
  private persistenceHealthy = true;
  private readonly counters = {
    enqueued: 0,
    duplicateEvents: 0,
    conflicts: 0,
    capacityRejections: 0,
    deliveryAttempts: 0,
    delivered: 0,
    failures: 0,
    restoredEvents: 0,
    persistenceFailures: 0,
  };

  constructor(private readonly dependencies: {
    client: { publish(event: T): Promise<void> };
    outbox?: AirGatewayEventOutbox<T>;
    maxPendingEvents?: number;
    retryDelayMs?: number;
    scheduleRetry?: (task: () => void, delayMs: number) => () => void;
  }) {
    this.maxPendingEvents = dependencies.maxPendingEvents ?? 256;
    this.retryDelayMs = dependencies.retryDelayMs ?? 1_000;
    this.initialized = !dependencies.outbox;
    if (!Number.isInteger(this.maxPendingEvents) || this.maxPendingEvents < 1) {
      throw new Error("Carrier event pending limit must be positive");
    }
    if (!Number.isInteger(this.retryDelayMs) || this.retryDelayMs < 1) {
      throw new Error("Carrier event retry delay must be positive");
    }
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    const loading = this.restore();
    this.initializing = loading;
    try {
      await loading;
      this.initialized = true;
      this.startDrain();
    } finally {
      if (this.initializing === loading) this.initializing = undefined;
    }
  }

  enqueue(event: T): Promise<boolean> {
    const result = this.enqueueTail.then(() => this.enqueueOne(event));
    this.enqueueTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async enqueueOne(event: T) {
    await this.initialize();
    const signature = createHash("sha256")
      .update(JSON.stringify(event)).digest("hex");
    const existing = this.pending.get(event.eventId);
    if (existing) {
      if (existing.signature !== signature) {
        this.counters.conflicts += 1;
        throw new Error("Carrier event id payload conflict");
      }
      this.counters.duplicateEvents += 1;
      return true;
    }
    if (this.pending.size >= this.maxPendingEvents) {
      this.counters.capacityRejections += 1;
      return false;
    }
    try {
      await this.dependencies.outbox?.put(structuredClone(event));
      this.persistenceHealthy = true;
    } catch {
      this.persistenceHealthy = false;
      this.counters.persistenceFailures += 1;
      return false;
    }
    this.pending.set(event.eventId, { event: { ...event }, signature });
    this.counters.enqueued += 1;
    this.startDrain();
    return true;
  }

  retryPending() {
    this.cancelRetry?.();
    this.cancelRetry = undefined;
    this.startDrain();
  }

  async flush() {
    await this.enqueueTail;
    await this.drainPromise;
  }

  dispose() {
    this.cancelRetry?.();
    this.cancelRetry = undefined;
  }

  metrics() {
    return { ...this.counters, pendingEvents: this.pending.size,
      draining: this.draining, persistenceHealthy: this.persistenceHealthy };
  }

  private async restore() {
    const events = await this.dependencies.outbox?.load() ?? [];
    if (events.length > this.maxPendingEvents) {
      throw new Error("Carrier event outbox exceeds configured capacity");
    }
    for (const event of events) {
      if (!validEvent(event) || this.pending.has(event.eventId)) {
        throw new Error("Carrier event outbox is invalid");
      }
      const signature = createHash("sha256")
        .update(JSON.stringify(event)).digest("hex");
      this.pending.set(event.eventId, {
        event: structuredClone(event),
        signature,
      });
      this.counters.restoredEvents += 1;
    }
  }

  private startDrain() {
    if (this.draining || this.pending.size === 0) return;
    this.draining = true;
    this.drainPromise = this.drain().finally(() => {
      this.draining = false;
    });
  }

  private async drain() {
    while (this.pending.size > 0) {
      const [eventId, pending] = this.pending.entries().next().value!;
      this.counters.deliveryAttempts += 1;
      try {
        await this.dependencies.client.publish(pending.event);
      } catch {
        this.counters.failures += 1;
        this.scheduleRetry();
        return;
      }
      try {
        await this.dependencies.outbox?.remove(eventId);
        this.persistenceHealthy = true;
      } catch {
        this.persistenceHealthy = false;
        this.counters.persistenceFailures += 1;
        this.scheduleRetry();
        return;
      }
      if (this.pending.get(eventId) === pending) this.pending.delete(eventId);
      this.counters.delivered += 1;
    }
  }

  private scheduleRetry() {
    if (this.cancelRetry) return;
    const schedule = this.dependencies.scheduleRetry ?? defaultSchedule;
    this.cancelRetry = schedule(() => {
      this.cancelRetry = undefined;
      this.startDrain();
    }, this.retryDelayMs);
  }
}

function validEvent(value: unknown): value is EventWithId {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as EventWithId).eventId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test((value as EventWithId).eventId);
}

function defaultSchedule(task: () => void, delayMs: number) {
  const timer = setTimeout(task, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
}
