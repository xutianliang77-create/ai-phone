import { describe, expect, it, vi } from "vitest";
import { AirGatewayCarrierEventDispatcher } from
  "./air-gateway-carrier-dispatcher.js";

describe("Air Gateway carrier event dispatcher", () => {
  it("retries the same event id after a transient API failure", async () => {
    const publish = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const dispatcher = new AirGatewayCarrierEventDispatcher({
      client: { publish },
      retryDelayMs: 1_000,
      scheduleRetry: vi.fn(() => () => undefined),
    });

    expect(await dispatcher.enqueue(event)).toBe(true);
    await dispatcher.flush();
    expect(dispatcher.metrics()).toMatchObject({ pendingEvents: 1, failures: 1 });

    dispatcher.retryPending();
    await dispatcher.flush();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toEqual(event);
    expect(dispatcher.metrics()).toMatchObject({ pendingEvents: 0, delivered: 1 });
  });

  it("coalesces an exact duplicate and rejects a conflicting event id", async () => {
    let release!: () => void;
    const publish = vi.fn(async () =>
      new Promise<void>((resolve) => { release = resolve; }));
    const dispatcher = new AirGatewayCarrierEventDispatcher({
      client: { publish },
      scheduleRetry: vi.fn(() => () => undefined),
    });

    expect(await dispatcher.enqueue(event)).toBe(true);
    expect(await dispatcher.enqueue(event)).toBe(true);
    await expect(dispatcher.enqueue({ ...event, carrierState: "ringing" }))
      .rejects.toThrow("payload conflict");
    release();
    await dispatcher.flush();
    expect(publish).toHaveBeenCalledOnce();
  });

  it("persists before delivery and restores an undelivered event after restart", async () => {
    const outbox = new TestEventOutbox();
    const order: string[] = [];
    outbox.onPut = () => order.push("put");
    const firstPublish = vi.fn(async () => {
      order.push("publish");
      throw new Error("network");
    });
    const first = new AirGatewayCarrierEventDispatcher({
      client: { publish: firstPublish },
      outbox,
      scheduleRetry: vi.fn(() => () => undefined),
    });
    await first.initialize();

    expect(await first.enqueue(event)).toBe(true);
    await first.flush();
    expect(order).toEqual(["put", "publish"]);
    expect(outbox.events).toEqual([event]);

    const publish = vi.fn(async () => undefined);
    const restarted = new AirGatewayCarrierEventDispatcher({
      client: { publish },
      outbox,
      scheduleRetry: vi.fn(() => () => undefined),
    });
    await restarted.initialize();
    await restarted.flush();

    expect(publish).toHaveBeenCalledWith(event);
    expect(outbox.events).toEqual([]);
    expect(restarted.metrics()).toMatchObject({ restoredEvents: 1 });
  });

  it("does not deliver when the event cannot be durably enqueued", async () => {
    const outbox = new TestEventOutbox();
    outbox.failPut = true;
    const publish = vi.fn(async () => undefined);
    const dispatcher = new AirGatewayCarrierEventDispatcher({
      client: { publish },
      outbox,
    });
    await dispatcher.initialize();

    expect(await dispatcher.enqueue(event)).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(dispatcher.metrics()).toMatchObject({ persistenceFailures: 1 });
  });
});

class TestEventOutbox {
  events: typeof event[] = [];
  failPut = false;
  onPut?: () => void;

  async load() {
    return structuredClone(this.events);
  }

  async put(value: typeof event) {
    if (this.failPut) throw new Error("disk unavailable");
    this.onPut?.();
    this.events = [structuredClone(value)];
  }

  async remove(eventId: string) {
    this.events = this.events.filter((value) => value.eventId !== eventId);
  }
}

const event = {
  eventId: "air_evt_123",
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
  eventSequence: 10,
  carrierState: "connected" as const,
  carrierCause: "none" as const,
  occurredAt: "2026-08-04T12:00:00.000Z",
};
