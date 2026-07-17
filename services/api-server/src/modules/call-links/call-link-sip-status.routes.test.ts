import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { liveKitSipParticipantIdentity } from "./livekit-sip-identity.js";

describe("internal LiveKit SIP status route", () => {
  let previousSecret: string | undefined;

  beforeEach(() => {
    previousSecret = process.env.INTERNAL_API_SECRET;
    process.env.INTERNAL_API_SECRET = "internal-secret-123456789";
    resetStore();
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = previousSecret;
  });

  it("persists active before acknowledging the Worker audio gate", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${call.callId}/sip-status`,
      headers: { authorization: "Bearer internal-secret-123456789" },
      payload: {
        operationId: call.operationId,
        participantIdentity: call.identity,
        participantSid: "PA_1",
        sipCallId: "sip-call-1",
        callStatus: "active",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      operationId: call.operationId,
      callStatus: "active",
      status: "active",
    });
    expect(getStoreSnapshot().providerOperations[0]).toMatchObject({
      status: "active",
      externalOperationId: "sip-call-1",
      externalResourceId: "PA_1",
    });
    expect(getStoreSnapshot().sessions[0]?.callLegs).toEqual([
      expect.objectContaining({
        participantIdentity: call.identity,
        participantRole: "guest",
        joinType: "sip",
        status: "active",
      }),
    ]);
  });

  it("rejects an operation or participant identity binding mismatch", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${call.callId}/sip-status`,
      headers: { authorization: "Bearer internal-secret-123456789" },
      payload: {
        operationId: call.operationId,
        participantIdentity: `${call.identity}-tampered`,
        callStatus: "active",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("call_link_binding_conflict");
    expect(getStoreSnapshot().providerOperations[0]?.status).toBe("accepted");
  });

  it("requires the internal API secret", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${call.callId}/sip-status`,
      payload: {
        operationId: call.operationId,
        participantIdentity: call.identity,
        callStatus: "active",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(getStoreSnapshot().providerOperations[0]?.status).toBe("accepted");
  });

  it("does not acknowledge active after the operation is terminal", async () => {
    const app = await buildApp();
    const call = await createAcceptedSipCall(app);
    updateProviderOperation({ operationId: call.operationId, status: "failed" });

    const response = await app.inject({
      method: "POST",
      url: `/internal/call-links/${call.callId}/sip-status`,
      headers: { authorization: "Bearer internal-secret-123456789" },
      payload: {
        operationId: call.operationId,
        participantIdentity: call.identity,
        callStatus: "active",
      },
    });
    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("sip_status_not_active");
    expect(getStoreSnapshot().sessions[0]?.callLegs ?? []).toEqual([]);
  });
});

async function createAcceptedSipCall(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const created = await app.inject({ method: "POST", url: "/call-links" });
  const callId = created.json().callId as string;
  const operation = beginProviderOperation({
    sessionId: callId,
    provider: "livekit_sip",
    operationType: "sip_outbound",
    idempotencyKey: `sip-outbound:${callId}`,
    requestHash: "request-hash",
  }).operation;
  updateProviderOperation({
    operationId: operation.id,
    status: "accepted",
  });
  return {
    callId,
    operationId: operation.id,
    identity: liveKitSipParticipantIdentity(callId, operation.id),
  };
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
