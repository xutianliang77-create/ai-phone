import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import {
  enqueueEnterpriseOutboxEvent,
} from "./enterprise-reliable-events.repository.js";
import {
  processEnterpriseOutboxEvent,
  recoverPendingEnterpriseOutboxEvents,
  type EnterpriseOutboxPublisher,
} from "./enterprise-outbox-processor.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

describe("enterprise outbox processor", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.enterpriseOutboxEvents = [];
  });

  it("leases concurrent delivery so one publisher call runs", async () => {
    const event = enqueue();
    let complete: (() => void) | undefined;
    const publish = vi.fn<EnterpriseOutboxPublisher["publish"]>(
      () => new Promise((resolve) => {
        complete = () => resolve({ status: "completed" });
      }),
    );
    const first = processEnterpriseOutboxEvent(ref(event), { publish }, {
      now: new Date("2026-07-16T00:01:00.000Z"),
    });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    const repeated = await processEnterpriseOutboxEvent(ref(event), { publish }, {
      now: new Date("2026-07-16T00:01:01.000Z"),
    });
    complete?.();
    const completed = await first;

    expect(repeated.status).toBe("busy");
    expect(completed.status).toBe("updated");
    expect(completed.event?.publishedAt).toBeTruthy();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.calls[0]?.[0].idempotencyKey).toBe("sync-contact-a");
  });

  it("retries a transient failure and does not republish a completed event", async () => {
    enqueue();
    const publish = vi.fn<EnterpriseOutboxPublisher["publish"]>()
      .mockResolvedValueOnce({ status: "retry", reason: "crm_unavailable" })
      .mockResolvedValueOnce({ status: "completed" });
    const first = await recoverPendingEnterpriseOutboxEvents(
      { publish },
      new Date("2026-07-16T00:01:00.000Z"),
    );
    const second = await recoverPendingEnterpriseOutboxEvents(
      { publish },
      new Date("2026-07-16T00:02:00.000Z"),
    );
    const third = await recoverPendingEnterpriseOutboxEvents(
      { publish },
      new Date("2026-07-16T00:03:00.000Z"),
    );

    expect(first).toMatchObject({ retriedCount: 1, publishedCount: 0 });
    expect(second).toMatchObject({ retriedCount: 0, publishedCount: 1 });
    expect(third).toMatchObject({ inspectedCount: 0 });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(getStoreSnapshot().enterpriseOutboxEvents[0]).toMatchObject({
      attempts: 2,
      publishedAt: expect.any(String),
    });
  });
});

function enqueue() {
  return enqueueEnterpriseOutboxEvent({
    context: createEnterpriseTenantContext({
      tenantId: "tenant-a",
      actorUserId: "owner-a",
      actorRole: "owner",
      traceId: "trace-a",
    }),
    aggregateType: "contact",
    aggregateId: "00000000-0000-4000-8000-000000000001",
    eventType: "crm.contact.sync",
    idempotencyKey: "sync-contact-a",
    payload: { contactId: "contact-a" },
    now: new Date("2026-07-16T00:00:00.000Z"),
  });
}

function ref(event: { id: string; tenantId: string }) {
  return { eventId: event.id, tenantId: event.tenantId };
}
