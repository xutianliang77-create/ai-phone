import { beforeEach, describe, expect, it } from "vitest";
import {
  getStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import {
  EnterpriseInboxPayloadConflictError,
  EnterpriseOutboxConflictError,
  processEnterpriseInboxEvent,
} from "./enterprise-reliable-events.repository.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

describe("enterprise reliable events repository", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.enterpriseTenants = [tenant("tenant-a"), tenant("tenant-b")];
    store.enterpriseInboxEvents = [];
    store.enterpriseOutboxEvents = [];
  });

  it("replays the same inbox event 100 times with one domain mutation and outbox", () => {
    const results = Array.from({ length: 100 }, () =>
      processEnterpriseInboxEvent({
        context: context("tenant-a"),
        source: "crm",
        sourceEventId: "crm-event-1",
        eventType: "contact.updated",
        payload: { contactId: "contact-a", revision: 7 },
        process: ({ enqueueOutbox }) => {
          getStoreSnapshot().enterpriseTenants[0]!.version += 1;
          enqueueOutbox(outbox("sync-contact-a"));
          return "processed";
        },
      })
    );

    expect(results[0]).toEqual({ status: "processed", result: "processed" });
    expect(results.slice(1).every(({ status }) => status === "duplicate"))
      .toBe(true);
    expect(getStoreSnapshot().enterpriseTenants[0]?.version).toBe(2);
    expect(getStoreSnapshot().enterpriseInboxEvents).toHaveLength(1);
    expect(getStoreSnapshot().enterpriseOutboxEvents).toHaveLength(1);
  });

  it("rejects a changed replay payload and conflicting outbox key", () => {
    processEnterpriseInboxEvent({
      context: context("tenant-a"),
      source: "crm",
      sourceEventId: "crm-event-1",
      eventType: "contact.updated",
      payload: { revision: 1 },
      process: ({ enqueueOutbox }) => {
        enqueueOutbox(outbox("sync-contact-a"));
      },
    });

    expect(() => processEnterpriseInboxEvent({
      context: context("tenant-a"),
      source: "crm",
      sourceEventId: "crm-event-1",
      eventType: "contact.updated",
      payload: { revision: 2 },
      process: () => undefined,
    })).toThrow(EnterpriseInboxPayloadConflictError);
    expect(() => processEnterpriseInboxEvent({
      context: context("tenant-a"),
      source: "calendar",
      sourceEventId: "calendar-event-1",
      eventType: "meeting.updated",
      payload: { revision: 1 },
      process: ({ enqueueOutbox }) => {
        enqueueOutbox({
          ...outbox("sync-contact-a"),
          payload: { changed: true },
        });
      },
    })).toThrow(EnterpriseOutboxConflictError);
    expect(getStoreSnapshot().enterpriseInboxEvents).toHaveLength(1);
  });

  it("canonicalizes JSON keys before detecting a duplicate replay", () => {
    const first = processEnterpriseInboxEvent({
      context: context("tenant-a"),
      source: "crm",
      sourceEventId: "canonical-event",
      eventType: "contact.updated",
      payload: { revision: 1, contact: { name: "A", id: "contact-a" } },
      process: () => "first",
    });
    const duplicate = processEnterpriseInboxEvent({
      context: context("tenant-a"),
      source: "crm",
      sourceEventId: "canonical-event",
      eventType: "contact.updated",
      payload: { contact: { id: "contact-a", name: "A" }, revision: 1 },
      process: () => "second",
    });

    expect(first.status).toBe("processed");
    expect(duplicate.status).toBe("duplicate");
  });

  it("allows the same provider identifiers in different tenants", () => {
    for (const tenantId of ["tenant-a", "tenant-b"]) {
      processEnterpriseInboxEvent({
        context: context(tenantId),
        source: "crm",
        sourceEventId: "shared-event",
        eventType: "contact.updated",
        payload: { revision: 1 },
        process: ({ enqueueOutbox }) => {
          enqueueOutbox(outbox("shared-outbox"));
        },
      });
    }

    expect(getStoreSnapshot().enterpriseInboxEvents).toHaveLength(2);
    expect(getStoreSnapshot().enterpriseOutboxEvents).toHaveLength(2);
  });

  it("rolls back the domain mutation, inbox, and outbox together", () => {
    expect(() => processEnterpriseInboxEvent({
      context: context("tenant-a"),
      source: "crm",
      sourceEventId: "crm-event-failed",
      eventType: "contact.updated",
      payload: { revision: 1 },
      process: ({ enqueueOutbox }) => {
        getStoreSnapshot().enterpriseTenants[0]!.version += 1;
        enqueueOutbox(outbox("failed-outbox"));
        throw new Error("domain failed");
      },
    })).toThrow("domain failed");

    expect(getStoreSnapshot().enterpriseTenants[0]?.version).toBe(1);
    expect(getStoreSnapshot().enterpriseInboxEvents).toEqual([]);
    expect(getStoreSnapshot().enterpriseOutboxEvents).toEqual([]);
  });

  it("rejects asynchronous domain processing before committing", () => {
    expect(() => processEnterpriseInboxEvent({
      context: context("tenant-a"),
      source: "crm",
      sourceEventId: "async-event",
      eventType: "contact.updated",
      payload: { revision: 1 },
      process: async ({ enqueueOutbox }) => {
        getStoreSnapshot().enterpriseTenants[0]!.version += 1;
        enqueueOutbox(outbox("async-outbox"));
      },
    })).toThrow("must be synchronous");

    expect(getStoreSnapshot().enterpriseTenants[0]?.version).toBe(1);
    expect(getStoreSnapshot().enterpriseInboxEvents).toEqual([]);
    expect(getStoreSnapshot().enterpriseOutboxEvents).toEqual([]);
  });
});

function context(tenantId: string) {
  return createEnterpriseTenantContext({
    tenantId,
    actorUserId: "system:webhook",
    traceId: `trace-${tenantId}`,
  });
}

function tenant(id: string) {
  const now = "2026-07-16T00:00:00.000Z";
  return {
    id,
    name: id,
    status: "active" as const,
    homeRegion: "cn",
    cellId: "cn-cell-01",
    planCode: "enterprise_trial",
    dataRetentionDays: 30,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function outbox(idempotencyKey: string) {
  return {
    aggregateType: "contact",
    aggregateId: "00000000-0000-4000-8000-000000000001",
    eventType: "crm.contact.sync",
    idempotencyKey,
    payload: { contactId: "contact-a" },
  };
}
