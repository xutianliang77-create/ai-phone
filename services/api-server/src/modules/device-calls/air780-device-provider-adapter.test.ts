import { describe, expect, it, vi } from "vitest";
import { Air780DeviceProviderAdapter } from "./air780-device-provider-adapter.js";

describe("Air780 business telephony provider", () => {
  it("maps place_phone_call to one fenced device dial command", async () => {
    const assertLease = vi.fn();
    const dial = vi.fn().mockResolvedValue({
      providerCallId: "air-call-1",
      state: "dialing",
    });
    const recordDial = vi.fn().mockResolvedValue(undefined);
    const provider = new Air780DeviceProviderAdapter({
      leaseVerifier: { assertLease },
      callRecorder: { recordDial },
      gateway: {
        dial,
        hangup: vi.fn(),
        sendDtmf: vi.fn(),
        reconcile: vi.fn(),
      },
    });

    const result = await provider.placePhoneCall({
      operationId: "op-1",
      sessionId: "session-1",
      expectedVersion: 1,
      idempotencyKey: "place_phone_call:session-1",
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      payload: {
        communicationSessionId: "session-1",
        transport: "air780_volte",
        callGeneration: 3,
        roomName: "call_session-1",
        phoneNumberReference: "+8613800138000",
        participantIdentity: "session-1:guest:air:air-001",
        deviceLease: {
          deviceId: "air-001",
          leaseId: "lease-1",
          fencingToken: 3,
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "air780_volte",
      externalResourceId: "air-call-1",
      result: { state: "dialing", deviceId: "air-001" },
    });
    expect(assertLease).toHaveBeenCalledOnce();
    expect(dial).toHaveBeenCalledWith(expect.objectContaining({
      commandId: "op-1",
      idempotencyKey: "place_phone_call:session-1",
      communicationSessionId: "session-1",
      fencingToken: 3,
    }));
    expect(recordDial).toHaveBeenCalledWith(expect.objectContaining({
      providerOperationId: "op-1",
      providerCallId: "air-call-1",
      callGeneration: 3,
    }));
  });

  it("rejects a session binding mismatch before touching the device", async () => {
    const dial = vi.fn();
    const provider = new Air780DeviceProviderAdapter({
      leaseVerifier: { assertLease: vi.fn() },
      callRecorder: { recordDial: vi.fn() },
      gateway: {
        dial,
        hangup: vi.fn(),
        sendDtmf: vi.fn(),
        reconcile: vi.fn(),
      },
    });
    const result = await provider.placePhoneCall({
      operationId: "op-1",
      sessionId: "session-1",
      expectedVersion: 1,
      idempotencyKey: "key-1",
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      payload: {
        communicationSessionId: "different-session",
        transport: "air780_volte",
        callGeneration: 3,
        roomName: "call_session-1",
        phoneNumberReference: "+8613800138000",
        participantIdentity: "session-1:guest:air:air-001",
        deviceLease: {
          deviceId: "air-001",
          leaseId: "lease-1",
          fencingToken: 3,
        },
      },
    });
    expect(result).toMatchObject({ ok: false, errorClass: "invalid_request" });
    expect(dial).not.toHaveBeenCalled();
  });

  it.each([
    { roomName: "call_other", participantIdentity: "session-1:guest:air:air-001" },
    { roomName: "call_session-1", participantIdentity: "other:guest:air:air-001" },
  ])("rejects cross-room or cross-identity device binding", async (override) => {
    const dial = vi.fn().mockResolvedValue({
      providerCallId: "should-not-dial",
      state: "dialing",
    });
    const provider = new Air780DeviceProviderAdapter({
      leaseVerifier: { assertLease: vi.fn() },
      callRecorder: { recordDial: vi.fn() },
      gateway: {
        dial,
        hangup: vi.fn(),
        sendDtmf: vi.fn(),
        reconcile: vi.fn(),
      },
    });
    const result = await provider.placePhoneCall({
      operationId: "op-binding",
      sessionId: "session-1",
      expectedVersion: 1,
      idempotencyKey: "key-binding",
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      payload: {
        communicationSessionId: "session-1",
        transport: "air780_volte",
        callGeneration: 3,
        phoneNumberReference: "+8613800138000",
        deviceLease: {
          deviceId: "air-001",
          leaseId: "lease-1",
          fencingToken: 3,
        },
        ...override,
      },
    });
    expect(result).toMatchObject({ ok: false, errorClass: "invalid_request" });
    expect(dial).not.toHaveBeenCalled();
  });

  it("requires reconciliation when call persistence fails after one dial", async () => {
    const dial = vi.fn().mockResolvedValue({
      providerCallId: "air-call-1",
      state: "dialing",
    });
    const provider = new Air780DeviceProviderAdapter({
      leaseVerifier: { assertLease: vi.fn() },
      callRecorder: {
        recordDial: vi.fn().mockRejectedValue(new Error("database unavailable")),
      },
      gateway: {
        dial,
        hangup: vi.fn(),
        sendDtmf: vi.fn(),
        reconcile: vi.fn(),
      },
    });

    await expect(provider.placePhoneCall({
      operationId: "op-persist",
      sessionId: "session-1",
      expectedVersion: 1,
      idempotencyKey: "place_phone_call:session-1",
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      payload: {
        communicationSessionId: "session-1",
        transport: "air780_volte",
        callGeneration: 3,
        roomName: "call_session-1",
        phoneNumberReference: "+8613800138000",
        participantIdentity: "session-1:guest:air:air-001",
        deviceLease: {
          deviceId: "air-001",
          leaseId: "lease-1",
          fencingToken: 3,
        },
      },
    })).resolves.toMatchObject({
      ok: false,
      errorClass: "unavailable",
      reconciliationRequired: true,
      externalResourceId: "air-call-1",
    });
    expect(dial).toHaveBeenCalledOnce();
  });
});
