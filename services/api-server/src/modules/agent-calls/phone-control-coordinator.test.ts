import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelephonyProvider } from "@translation/contracts";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { beginProviderOperation } from
  "../provider-operations/provider-operations.repository.js";
import { executePhoneControl } from "./phone-control-coordinator.js";

describe("phone control coordinator", () => {
  beforeEach(() => {
    getStoreSnapshot().providerOperations = [];
  });

  it("executes one fenced Air DTMF command and replays its result", async () => {
    const sendPhoneDtmf = vi.fn<TelephonyProvider["sendPhoneDtmf"]>(
      async (request) => success(request, "active"),
    );
    const operation = startedOperation("phone_dtmf", "tool-1");
    const provider = telephonyProvider({ sendPhoneDtmf });

    const first = await executePhoneControl({
      action: "dtmf",
      operation,
      provider,
      payload: { ...payload(), digits: "5" },
      timeoutMs: 1_000,
    });
    const replay = await executePhoneControl({
      action: "dtmf",
      operation,
      provider,
      payload: { ...payload(), digits: "5" },
      timeoutMs: 1_000,
    });

    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(sendPhoneDtmf).toHaveBeenCalledTimes(1);
    expect(sendPhoneDtmf).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        providerCallId: "air-call-1",
        callGeneration: 7,
        deviceLease: expect.objectContaining({ fencingToken: 7 }),
      }),
    }));
  });

  it("quarantines an uncertain Air hangup and never sends it twice", async () => {
    const hangupPhoneCall = vi.fn<TelephonyProvider["hangupPhoneCall"]>(
      async () => ({
        ok: false,
        provider: "air780_volte",
        errorClass: "timeout",
        retryable: true,
        reconciliationRequired: true,
      }),
    );
    const operation = startedOperation("phone_hangup", "voice-agent-runtime");
    const provider = telephonyProvider({ hangupPhoneCall });

    const first = await executePhoneControl({
      action: "hangup",
      operation,
      provider,
      payload: payload(),
      timeoutMs: 1_000,
    });
    const replay = await executePhoneControl({
      action: "hangup",
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
    expect(replay).toMatchObject({
      ok: false,
      reconciliationRequired: true,
      errorClass: "timeout",
    });
    expect(hangupPhoneCall).toHaveBeenCalledTimes(1);
  });
});

function startedOperation(
  operationType: "phone_dtmf" | "phone_hangup",
  operationKey: string,
) {
  const result = beginProviderOperation({
    sessionId: "session-1",
    provider: "air780_volte",
    operationType,
    operationKey,
    idempotencyKey: `${operationType}:${operationKey}`,
    requestHash: "request-hash",
  });
  if (result.status !== "started") throw new Error("operation was not started");
  return result.operation;
}

function payload() {
  return {
    communicationSessionId: "session-1",
    providerCallId: "air-call-1",
    callGeneration: 7,
    deviceLease: {
      deviceId: "air-001",
      leaseId: "lease-1",
      fencingToken: 7,
    },
  };
}

function telephonyProvider(overrides: Partial<TelephonyProvider>): TelephonyProvider {
  const unsupported = async () => ({
    ok: false as const,
    provider: "air780_volte" as const,
    errorClass: "unavailable" as const,
    retryable: false,
    reconciliationRequired: false,
  });
  return {
    placePhoneCall: unsupported,
    sendPhoneDtmf: unsupported,
    hangupPhoneCall: unsupported,
    reconcilePhoneCall: unsupported,
    ...overrides,
  };
}

function success(
  request: Parameters<TelephonyProvider["sendPhoneDtmf"]>[0],
  state: "active",
) {
  return {
    ok: true as const,
    provider: "air780_volte" as const,
    externalOperationId: request.operationId,
    externalResourceId: request.payload.providerCallId,
    capabilities: ["dtmf"],
    result: {
      communicationSessionId: request.sessionId,
      providerCallId: request.payload.providerCallId,
      state,
      deviceId: request.payload.deviceLease?.deviceId,
    },
  };
}
