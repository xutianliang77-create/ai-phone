import { describe, expect, it, vi } from "vitest";
import {
  createEnvironmentEnterpriseOutboxPublisher,
} from "./enterprise-postgres-outbox-publisher.js";

const event = {
  id: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  aggregateType: "tenant",
  aggregateId: "00000000-0000-4000-8000-000000000002",
  eventType: "tenant.updated",
  idempotencyKey: "event-1",
  payload: { status: "active" },
  traceId: "trace-1",
  attempts: 1,
  availableAt: "2026-07-17T00:00:00.000Z",
  createdAt: "2026-07-17T00:00:00.000Z",
};

describe("enterprise PostgreSQL outbox publisher", () => {
  it("fails closed when the external publisher is not configured", () => {
    expect(() => createEnvironmentEnterpriseOutboxPublisher({ env: {} }))
      .toThrow("not configured");
  });

  it("publishes with a stable event idempotency key", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const publisher = createEnvironmentEnterpriseOutboxPublisher({
      env: {
        ENTERPRISE_OUTBOX_PUBLISHER_URL: "https://events.example.com/outbox",
        ENTERPRISE_OUTBOX_PUBLISHER_TOKEN: "publisher-token",
      },
      fetcher: fetcher as typeof fetch,
    });
    await expect(publisher.publish(event)).resolves.toEqual({
      status: "completed",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://events.example.com/outbox",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "idempotency-key": event.id,
        }),
      }),
    );
  });

  it("returns explicit retry without fabricating success", async () => {
    const publisher = createEnvironmentEnterpriseOutboxPublisher({
      env: {
        ENTERPRISE_OUTBOX_PUBLISHER_URL: "https://events.example.com/outbox",
        ENTERPRISE_OUTBOX_PUBLISHER_TOKEN: "publisher-token",
      },
      fetcher: vi.fn(async () => new Response(null, { status: 503 })) as
        unknown as typeof fetch,
    });
    await expect(publisher.publish(event)).resolves.toEqual({
      status: "retry",
      reason: "publisher_unavailable",
    });
  });
});
