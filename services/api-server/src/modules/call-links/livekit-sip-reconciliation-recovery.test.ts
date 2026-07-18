import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { observeLiveKitSipCompletion } from "./livekit-sip-reconciliation.js";
import { recoverPendingLiveKitSipCompletions } from "./livekit-sip-reconciliation-recovery.js";

describe("LiveKit SIP reconciliation recovery", () => {
  beforeEach(resetStore);

  it("zero-bills an unanswered completion after the reordering grace", async () => {
    const operation = await acceptedOperation();
    const observedAt = new Date("2026-07-17T00:00:00.000Z");
    await observeLiveKitSipCompletion({
      operationId: operation.id,
      event: "participant_left",
      observedAt,
    });

    const result = await recoverPendingLiveKitSipCompletions({
      now: new Date("2026-07-17T00:00:31.000Z"),
      graceSeconds: 30,
    });

    expect(result).toEqual({ inspectedCount: 1, recoveredCount: 1 });
    expect(getStoreSnapshot().providerOperations[0]?.status).toBe("failed");
    expect(getStoreSnapshot().sessions[0]).toMatchObject({
      status: "ended",
      consumedSeconds: 0,
    });
  });

  it("keeps the operation open during the out-of-order grace window", async () => {
    const operation = await acceptedOperation();
    await observeLiveKitSipCompletion({
      operationId: operation.id,
      event: "participant_left",
      observedAt: new Date("2026-07-17T00:00:00.000Z"),
    });

    const result = await recoverPendingLiveKitSipCompletions({
      now: new Date("2026-07-17T00:00:29.000Z"),
      graceSeconds: 30,
    });

    expect(result).toEqual({ inspectedCount: 0, recoveredCount: 0 });
    expect(getStoreSnapshot().providerOperations[0]?.status).toBe("unknown");
    expect(getStoreSnapshot().sessions[0]?.status).not.toBe("ended");
  });
});

async function acceptedOperation() {
  const app = await buildApp();
  const created = await app.inject({ method: "POST", url: "/call-links" });
  await app.close();
  const callId = created.json().callId as string;
  const operation = beginProviderOperation({
    sessionId: callId,
    provider: "livekit_sip",
    operationType: "sip_outbound",
    idempotencyKey: `sip-outbound:${callId}`,
    requestHash: "request-hash",
  }).operation;
  updateProviderOperation({ operationId: operation.id, status: "accepted" });
  return operation;
}

function resetStore() {
  const store = getStoreSnapshot();
  store.accounts = [];
  store.sessions = [];
  store.usageBalances = {};
  store.usageHolds = [];
  store.billingLedger = [];
  store.providerOperations = [];
  store.inboxEvents = [];
  store.outboxEvents = [];
}
