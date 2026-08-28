import { describe, expect, it, vi } from "vitest";
import { Air780DeviceProviderAdapter } from
  "./air780-device-provider-adapter.js";

describe("Air780 provider durable DIAL ordering", () => {
  it("does not dial when the durable call binding cannot be persisted", async () => {
    const fixture = setup({
      recordDial: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });

    await expect(fixture.provider.placePhoneCall(request("op-persist")))
      .resolves.toMatchObject({
        ok: false,
        errorClass: "unavailable",
        reconciliationRequired: false,
        externalResourceId: expect.stringMatching(/^air_[0-9a-f]{32}$/),
      });
    expect(fixture.dial).not.toHaveBeenCalled();
  });

  it("terminalizes a definitive Gateway rejection", async () => {
    const rejected = namedError("DeviceCommandRejected", "stale fence");
    const fixture = setup({ dialError: rejected });

    const result = await fixture.provider.placePhoneCall(request("op-rejected"));

    expect(result).toMatchObject({
      ok: false,
      errorClass: "conflict",
      retryable: false,
      reconciliationRequired: false,
    });
    expect(fixture.recordDialRejected).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOperationId: "op-rejected",
        providerCallId: expect.stringMatching(/^air_[0-9a-f]{32}$/),
        callGeneration: 3,
      }),
    );
  });

  it("requires reconciliation when a definitive rejection cannot be recorded", async () => {
    const fixture = setup({
      dialError: namedError("DeviceCommandRejected", "stale fence"),
      recordDialRejected: vi.fn().mockRejectedValue(
        new Error("database unavailable"),
      ),
    });

    const result = await fixture.provider.placePhoneCall(
      request("op-reject-persist"),
    );

    expect(result).toMatchObject({
      ok: false,
      errorClass: "unavailable",
      retryable: true,
      reconciliationRequired: true,
    });
  });

  it("terminalizes a command that the Gateway proves was not dispatched", async () => {
    const fixture = setup({
      dialError: namedError("DeviceCommandNotDispatched", "ledger unavailable"),
    });

    const result = await fixture.provider.placePhoneCall(
      request("op-not-dispatched"),
    );

    expect(result).toMatchObject({
      ok: false,
      errorClass: "unavailable",
      retryable: true,
      reconciliationRequired: false,
    });
    expect(fixture.recordDialRejected).toHaveBeenCalledOnce();
  });
});

function setup(options: {
  dialError?: Error;
  recordDial?: ReturnType<typeof vi.fn>;
  recordDialRejected?: ReturnType<typeof vi.fn>;
} = {}) {
  const dial = options.dialError
    ? vi.fn().mockRejectedValue(options.dialError)
    : vi.fn(async (input: { providerCallId: string }) => ({
      providerCallId: input.providerCallId,
      state: "dialing" as const,
    }));
  const recordDialRejected = options.recordDialRejected ??
    vi.fn().mockResolvedValue(undefined);
  const provider = new Air780DeviceProviderAdapter({
    leaseVerifier: { assertLease: vi.fn() },
    callRecorder: {
      recordDial: options.recordDial ?? vi.fn().mockResolvedValue(undefined),
      recordDialRejected,
    },
    roomAccessIssuer: {
      issue: vi.fn().mockResolvedValue({
        wsUrl: "wss://livekit.example.cn",
        token: "device-room-token",
        expiresAt: "2099-01-01T00:00:00.000Z",
        mediaPolicy: "translation_isolated",
      }),
    },
    gateway: {
      dial,
      hangup: vi.fn(),
      sendDtmf: vi.fn(),
      reconcile: vi.fn(),
    },
  });
  return { provider, dial, recordDialRejected };
}

function request(operationId: string) {
  return {
    operationId,
    sessionId: "session-1",
    expectedVersion: 1,
    idempotencyKey: "place_phone_call:session-1",
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    payload: {
      communicationSessionId: "session-1",
      transport: "air780_volte" as const,
      callGeneration: 3,
      mediaPolicy: "translation_isolated" as const,
      roomName: "call_session-1",
      phoneNumberReference: "+8613800138000",
      participantIdentity: "session-1:guest:air:air-001",
      deviceLease: {
        deviceId: "air-001",
        leaseId: "lease-1",
        fencingToken: 3,
      },
    },
  };
}

function namedError(name: string, message: string) {
  const error = new Error(message);
  error.name = name;
  return error;
}
