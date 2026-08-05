import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelephonyProvider } from "@translation/contracts";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { beginProviderOperation } from
  "../provider-operations/provider-operations.repository.js";
import { executePhoneOutbound } from "./phone-outbound-coordinator.js";

describe("phone outbound coordinator", () => {
  beforeEach(() => {
    getStoreSnapshot().providerOperations = [];
  });

  it("executes one Air dial and replays the accepted operation", async () => {
    const placePhoneCall = vi.fn<TelephonyProvider["placePhoneCall"]>(
      async (request) => ({
        ok: true,
        provider: "air780_volte",
        externalOperationId: request.operationId,
        externalResourceId: "air-call-1",
        capabilities: ["phone_outbound"],
        result: {
          communicationSessionId: request.sessionId,
          providerCallId: "air-call-1",
          participantIdentity: request.payload.participantIdentity,
          state: "dialing",
          deviceId: "air-001",
        },
      }),
    );
    const provider = telephonyProvider(placePhoneCall);
    const operation = startedOperation();

    const first = await executePhoneOutbound({
      operation,
      provider,
      payload: payload(),
      timeoutMs: 1_000,
    });
    const second = await executePhoneOutbound({
      operation,
      provider,
      payload: payload(),
      timeoutMs: 1_000,
    });

    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      providerCallId: "air-call-1",
    });
    expect(second).toMatchObject({
      ok: true,
      replayed: true,
      providerCallId: "air-call-1",
    });
    expect(placePhoneCall).toHaveBeenCalledTimes(1);
    expect(operation).toMatchObject({
      status: "accepted",
      externalResourceId: "air-call-1",
    });
  });

  it("quarantines an uncertain dial and never redials it", async () => {
    const placePhoneCall = vi.fn<TelephonyProvider["placePhoneCall"]>(
      async () => ({
        ok: false,
        provider: "air780_volte",
        errorClass: "timeout",
        retryable: true,
        reconciliationRequired: true,
      }),
    );
    const provider = telephonyProvider(placePhoneCall);
    const operation = startedOperation();

    const first = await executePhoneOutbound({
      operation,
      provider,
      payload: payload(),
      timeoutMs: 1_000,
    });
    const second = await executePhoneOutbound({
      operation,
      provider,
      payload: payload(),
      timeoutMs: 1_000,
    });

    expect(first).toMatchObject({
      ok: false,
      reconciliationRequired: true,
      errorClass: "timeout",
    });
    expect(second).toMatchObject({
      ok: false,
      reconciliationRequired: true,
      errorClass: "timeout",
    });
    expect(placePhoneCall).toHaveBeenCalledTimes(1);
    expect(operation.status).toBe("unknown");
  });
});

function startedOperation() {
  const result = beginProviderOperation({
    sessionId: "session-1",
    provider: "air780_volte",
    operationType: "phone_outbound",
    operationKey: "draft-1",
    idempotencyKey: "agent-dial:session-1",
    requestHash: "request-hash",
  });
  if (result.status !== "started") throw new Error("operation was not started");
  return result.operation;
}

function payload() {
  return {
    communicationSessionId: "session-1",
    transport: "air780_volte" as const,
    callGeneration: 1,
    roomName: "call_session-1",
    phoneNumberReference: "+8613800138000",
    participantIdentity: "session-1:guest:air:air-001",
    deviceLease: {
      deviceId: "air-001",
      leaseId: "lease-1",
      fencingToken: 1,
    },
  };
}

function telephonyProvider(
  placePhoneCall: TelephonyProvider["placePhoneCall"],
): TelephonyProvider {
  const unsupported = async () => ({
    ok: false as const,
    provider: "air780_volte" as const,
    errorClass: "unavailable" as const,
    retryable: false,
    reconciliationRequired: false,
  });
  return {
    placePhoneCall,
    sendPhoneDtmf: unsupported,
    hangupPhoneCall: unsupported,
    reconcilePhoneCall: unsupported,
  };
}
