import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import {
  recoverPendingTranslationControls,
  translationControlDeliveryKey,
} from "./translation-call-control-outbox.js";

describe("translation control outbox recovery", () => {
  beforeEach(() => {
    getStoreSnapshot().providerOperations = [];
    getStoreSnapshot().outboxEvents = [];
  });

  it("expires a prepared typed claim without publishing it to another Worker", async () => {
    getStoreSnapshot().providerOperations.push({
      id: "typed-control-1",
      sessionId: "call-1",
      provider: "livekit",
      operationType: "translation_type_to_speak",
      operationKey: "c1:d7:typed-text-0001",
      idempotencyKey: "translation-type:call-1:typed-text-0001",
      requestHash: "typed-request-hash-at-least-sixteen-bytes",
      status: "active",
      attempt: 1,
      version: 3,
      startedAt: "2026-08-13T08:00:00.000Z",
      acceptedAt: "2026-08-13T08:00:01.000Z",
      answeredAt: "2026-08-13T08:00:02.000Z",
      updatedAt: "2026-08-13T08:00:02.000Z",
    });
    getStoreSnapshot().outboxEvents.push({
      idempotencyKey: translationControlDeliveryKey("typed-control-1"),
      sessionId: "call-1",
      eventType: "translation_call_control.delivery",
      payload: { redacted: true },
      attempts: 1,
      availableAt: "2026-08-13T08:04:00.000Z",
      createdAt: "2026-08-13T08:00:00.000Z",
    });

    const result = await recoverPendingTranslationControls(
      new Date("2026-08-13T08:03:00.000Z"),
    );

    expect(result).toMatchObject({ sessions: 0, delivered: 0, failed: 1 });
    expect(getStoreSnapshot().providerOperations[0]).toMatchObject({
      status: "failed",
      lastErrorClass: "translation_control_expired",
    });
    expect(getStoreSnapshot().outboxEvents[0]).toMatchObject({
      publishedAt: expect.any(String),
    });
  });
});
