import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from
  "../../infrastructure/storage/json-store.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { registerCallLeg } from "./call-links.service.js";

describe("provider-neutral call link phone status route", () => {
  beforeEach(resetStore);

  it("does not promote accepted SIP from LiveKit participant presence", async () => {
    const app = await buildApp();
    const callId = await createCallLink(app);
    await registerCallLeg({
      callId,
      participantIdentity: `${callId}:worker:translation`,
      participantRole: "worker",
      joinType: "worker",
    });
    const operation = createAcceptedOperation(callId, "sip_outbound");

    const waiting = await app.inject({
      method: "GET",
      url: `/call-links/${callId}/phone-status`,
    });

    expect(waiting.statusCode).toBe(200);
    expect(waiting.json()).toMatchObject({
      callId,
      operationId: operation.id,
      provider: "livekit_sip",
      providerOperationStatus: "accepted",
      providerCallId: "sip-call-1",
    });
    expect(waiting.json()).not.toHaveProperty("carrierState");

    updateProviderOperation({
      operationId: operation.id,
      status: "active",
      externalOperationId: "sip-call-1",
      externalResourceId: "PA_1",
    });
    const active = await app.inject({
      method: "GET",
      url: `/call-links/${callId}/phone-status`,
    });
    await app.close();

    expect(active.statusCode).toBe(200);
    expect(active.json()).toMatchObject({
      providerOperationStatus: "active",
      providerCallId: "sip-call-1",
    });
  });

  it("fails closed when a session has both phone provider bindings", async () => {
    const app = await buildApp();
    const callId = await createCallLink(app);
    createAcceptedOperation(callId, "sip_outbound");
    createAcceptedOperation(callId, "phone_outbound");

    const response = await app.inject({
      method: "GET",
      url: `/call-links/${callId}/phone-status`,
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "phone_outbound_binding_conflict" },
    });
  });
});

async function createCallLink(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: "POST", url: "/call-links" });
  return response.json().callId as string;
}

function createAcceptedOperation(
  callId: string,
  operationType: "sip_outbound" | "phone_outbound",
) {
  const provider = operationType === "sip_outbound"
    ? "livekit_sip" as const
    : "air780_volte" as const;
  const operation = beginProviderOperation({
    sessionId: callId,
    provider,
    operationType,
    idempotencyKey: `${operationType}:${callId}`,
    requestHash: `${operationType}-request-hash`,
  }).operation;
  updateProviderOperation({
    operationId: operation.id,
    status: "accepted",
    externalOperationId: operationType === "sip_outbound"
      ? "sip-call-1"
      : "air-operation-1",
    externalResourceId: operationType === "sip_outbound"
      ? "PA_1"
      : "air-call-1",
  });
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
