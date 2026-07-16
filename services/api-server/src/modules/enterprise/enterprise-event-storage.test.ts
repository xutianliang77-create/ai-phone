import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEmptyStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import {
  SqliteSnapshotStore,
} from "../../infrastructure/storage/sqlite-snapshot-store.js";

describe("enterprise reliable event storage", () => {
  it("persists enterprise inbox and mutable outbox records", () => {
    const fixture = databaseFixture();
    try {
      const writer = fixture.open();
      const snapshot = writer.read();
      snapshot.enterpriseInboxEvents.push(inbox("inbox-a"));
      snapshot.enterpriseOutboxEvents.push(outbox("outbox-a"));
      writer.save(snapshot);
      snapshot.enterpriseOutboxEvents[0]!.attempts = 1;
      snapshot.enterpriseOutboxEvents[0]!.publishedAt =
        "2026-07-16T00:01:00.000Z";
      writer.save(snapshot);
      writer.close();

      const reader = fixture.open();
      const stored = reader.read();
      reader.close();
      expect(stored.enterpriseInboxEvents).toEqual([inbox("inbox-a")]);
      expect(stored.enterpriseOutboxEvents[0]).toMatchObject({
        id: "outbox-a",
        attempts: 1,
        publishedAt: "2026-07-16T00:01:00.000Z",
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("enforces tenant-scoped provider and idempotency uniqueness", () => {
    const fixture = databaseFixture();
    try {
      const writerA = fixture.open();
      const writerB = fixture.open();
      const snapshotA = writerA.read();
      const snapshotB = writerB.read();
      snapshotA.enterpriseInboxEvents.push(inbox("inbox-a"));
      snapshotB.enterpriseInboxEvents.push(inbox("inbox-b"));
      writerA.save(snapshotA);
      expect(() => writerB.save(snapshotB)).toThrow();
      writerA.close();
      writerB.close();
    } finally {
      fixture.cleanup();
    }
  });

  it("enforces tenant-scoped outbox idempotency uniqueness", () => {
    const fixture = databaseFixture();
    try {
      const writerA = fixture.open();
      const writerB = fixture.open();
      const snapshotA = writerA.read();
      const snapshotB = writerB.read();
      snapshotA.enterpriseOutboxEvents.push(outbox("outbox-a"));
      snapshotB.enterpriseOutboxEvents.push(outbox("outbox-b"));
      writerA.save(snapshotA);
      expect(() => writerB.save(snapshotB)).toThrow();
      writerA.close();
      writerB.close();
    } finally {
      fixture.cleanup();
    }
  });

  it("allows delivery updates but rejects outbox content mutation", () => {
    const fixture = databaseFixture();
    try {
      const writer = fixture.open();
      const snapshot = writer.read();
      snapshot.enterpriseOutboxEvents.push(outbox("outbox-a"));
      writer.save(snapshot);
      snapshot.enterpriseOutboxEvents[0]!.attempts = 1;
      writer.save(snapshot);
      snapshot.enterpriseOutboxEvents[0]!.payload = { changed: true };
      expect(() => writer.save(snapshot)).toThrow("content is immutable");
      writer.close();
    } finally {
      fixture.cleanup();
    }
  });
});

function databaseFixture() {
  const directory = mkdtempSync(join(tmpdir(), "enterprise-events-"));
  const file = join(directory, "store.sqlite");
  return {
    open: () => new SqliteSnapshotStore(file, createEmptyStoreSnapshot()),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function inbox(id: string) {
  return {
    id,
    tenantId: "tenant-a",
    source: "crm",
    sourceEventId: "event-a",
    eventType: "contact.updated",
    payloadHash: "a".repeat(64),
    payload: { revision: 1 },
    traceId: "trace-a",
    receivedAt: "2026-07-16T00:00:00.000Z",
    processedAt: "2026-07-16T00:00:00.000Z",
  };
}

function outbox(id: string) {
  return {
    id,
    tenantId: "tenant-a",
    aggregateType: "contact",
    aggregateId: "00000000-0000-4000-8000-000000000001",
    eventType: "crm.contact.sync",
    idempotencyKey: "sync-contact-a",
    payload: { contactId: "contact-a" },
    traceId: "trace-a",
    attempts: 0,
    availableAt: "2026-07-16T00:00:00.000Z",
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}
