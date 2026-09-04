import { describe, expect, it, vi } from "vitest";
import { AirDeviceGatewayCommandIngress } from
  "../device/vuart-v1-command-ingress.js";
import { FixtureVuartV1CommandTransport } from
  "../device/vuart-v1-command-transport-fixture.js";
import {
  VuartV1CommandReplayGuard,
  type VuartV1CommandEffect,
} from "../device/vuart-v1-command-replay-guard.js";
import { AirGatewayCommandService } from "./air-gateway-command-service.js";

describe("Air Gateway HTTP command service", () => {
  it("prepares the exact room and replays a completed DIAL once", async () => {
    const fixture = setup();

    const first = await fixture.service.execute(dial());
    const replay = await fixture.service.execute(dial());

    expect(first).toMatchObject({
      status: "ack",
      providerCallId: binding.providerCallId,
      replayed: false,
    });
    expect(replay).toMatchObject({
      status: "ack",
      providerCallId: binding.providerCallId,
      replayed: true,
    });
    expect(fixture.prepareRoom).toHaveBeenCalledOnce();
    expect(fixture.prepareRoom).toHaveBeenCalledWith(expect.objectContaining({
      roomName: "call_comm-1",
      participantIdentity: "comm-1:guest:air:air-780-1",
      roomAccess: expect.objectContaining({ token: "room-token" }),
    }));
    expect(fixture.apply).toHaveBeenCalledOnce();
  });

  it("rejects command and idempotency payload conflicts before serial", async () => {
    const fixture = setup();
    expect(await fixture.service.execute(dial())).toMatchObject({ status: "ack" });

    expect(await fixture.service.execute(dial({
      phoneNumberReference: "+8613900139000",
    }))).toEqual({ status: "conflict", reason: "command_payload_conflict" });
    expect(await fixture.service.execute(dial({
      commandId: "command-2",
    }))).toEqual({ status: "conflict", reason: "idempotency_key_conflict" });
    expect(fixture.apply).toHaveBeenCalledOnce();
  });

  it("requires an explicit Air raw-media policy in the command binding", async () => {
    const fixture = setup();
    const valid = dial();
    const { mediaPolicy: _removed, ...unboundAccess } = valid.roomAccess;

    expect(await fixture.service.execute({
      ...valid,
      commandId: "missing-policy",
      idempotencyKey: "missing-policy",
      roomAccess: unboundAccess,
    })).toEqual({ status: "invalid_request", reason: "command_schema_invalid" });
    expect(await fixture.service.execute(dial({
      commandId: "invalid-policy",
      idempotencyKey: "invalid-policy",
      roomAccess: { ...valid.roomAccess, mediaPolicy: "broadcast_all" },
    }))).toEqual({ status: "invalid_request", reason: "command_schema_invalid" });
    expect(fixture.prepareRoom).not.toHaveBeenCalled();
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("caches ACK-loss as reconcile-required and never redials", async () => {
    const fixture = setup();
    fixture.transport.dropNextResponses(2);

    const first = await fixture.service.execute(dial());
    const replay = await fixture.service.execute(dial());

    expect(first).toMatchObject({
      status: "timeout_reconcile_required",
      replayed: false,
    });
    expect(replay).toMatchObject({
      status: "timeout_reconcile_required",
      replayed: true,
    });
    expect(fixture.apply).toHaveBeenCalledOnce();
    expect(fixture.transport.requests()).toHaveLength(2);
  });

  it("restores a completed DIAL from the durable ledger without serial", async () => {
    const ledger = new TestCommandLedger();
    const first = setup({ ledger });
    await first.service.initialize();
    expect(await first.service.execute(dial())).toMatchObject({ status: "ack" });

    const restarted = setup({ ledger });
    await restarted.service.initialize();
    expect(await restarted.service.execute(dial())).toMatchObject({
      status: "ack",
      replayed: true,
    });
    expect(restarted.prepareRoom).not.toHaveBeenCalled();
    expect(restarted.apply).not.toHaveBeenCalled();
  });

  it("fails before room or serial when the pre-dispatch ledger write fails", async () => {
    const ledger = new TestCommandLedger();
    ledger.failUpsertAt = 1;
    const fixture = setup({ ledger });
    await fixture.service.initialize();

    expect(await fixture.service.execute(dial())).toEqual({
      status: "unavailable",
      reason: "command_ledger_failed",
    });
    expect(fixture.prepareRoom).not.toHaveBeenCalled();
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("returns reconcile-required when ACK cannot replace the pending record", async () => {
    const ledger = new TestCommandLedger();
    ledger.failUpsertAt = 2;
    const first = setup({ ledger });
    await first.service.initialize();

    expect(await first.service.execute(dial())).toMatchObject({
      status: "timeout_reconcile_required",
      replayed: false,
    });
    expect(first.apply).toHaveBeenCalledOnce();

    const restarted = setup({ ledger });
    await restarted.service.initialize();
    expect(await restarted.service.execute(dial())).toMatchObject({
      status: "timeout_reconcile_required",
      replayed: true,
    });
    expect(restarted.apply).not.toHaveBeenCalled();
  });

  it("rejects stale fences and generations with zero side effects", async () => {
    const fixture = setup();

    expect(await fixture.service.execute(dial({
      commandId: "stale-fence",
      idempotencyKey: "stale-fence-key",
      fencingToken: binding.fencingToken - 1,
    }))).toMatchObject({
      status: "error",
      error: { errorCode: "stale_fence" },
    });
    expect(await fixture.service.execute(dial({
      commandId: "stale-generation",
      idempotencyKey: "stale-generation-key",
      callGeneration: binding.callGeneration - 1,
    }))).toMatchObject({
      status: "error",
      error: { errorCode: "stale_generation" },
    });
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("reconciles from the carrier observer without writing VUART", async () => {
    const fixture = setup();
    fixture.observeCarrier.mockResolvedValue({
      state: "connected",
      observedAt: "2026-08-04T12:00:00.000Z",
    });

    const result = await fixture.service.execute(reconcile());

    expect(result).toEqual({
      status: "observed",
      state: "connected",
      observedAt: "2026-08-04T12:00:00.000Z",
      replayed: false,
    });
    expect(fixture.transport.requests()).toHaveLength(0);
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("rejects a forged room binding before room or serial work", async () => {
    const fixture = setup();

    const result = await fixture.service.execute(dial({
      participantIdentity: "comm-1:guest:air:other-device",
    }));

    expect(result).toMatchObject({ status: "invalid_request" });
    expect(fixture.prepareRoom).not.toHaveBeenCalled();
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("fails closed before room and serial when the device boot is not admitted", async () => {
    const prepareDevice = vi.fn().mockRejectedValue(new Error("not admitted"));
    const fixture = setup({ prepareDevice });

    const result = await fixture.service.execute(dial());

    expect(result).toEqual({
      status: "blocked",
      reason: "boot_not_admitted",
      attempts: 0,
      replayed: false,
    });
    expect(fixture.prepareRoom).not.toHaveBeenCalled();
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("rolls back a new device binding when room preparation fails", async () => {
    const rollbackDevice = vi.fn(async () => undefined);
    const fixture = setup({
      prepareDevice: vi.fn(async () => true),
      prepareRoom: vi.fn().mockRejectedValue(new Error("room unavailable")),
      rollbackDevice,
    });

    expect(await fixture.service.execute(dial())).toEqual({
      status: "unavailable",
      reason: "room_not_ready",
    });
    expect(rollbackDevice).toHaveBeenCalledOnce();
    expect(fixture.apply).not.toHaveBeenCalled();
  });

  it("clears newly prepared room and device state after a definitive error", async () => {
    const rollbackDevice = vi.fn(async () => undefined);
    const clearRoom = vi.fn(async () => undefined);
    const fixture = setup({
      prepareDevice: vi.fn(async () => true),
      prepareRoom: vi.fn(async () => true),
      rollbackDevice,
      clearRoom,
      effectResult: { status: "rejected", errorCode: "invalid_state" },
    });

    expect(await fixture.service.execute(dial())).toMatchObject({
      status: "error",
      replayed: false,
    });
    expect(clearRoom).toHaveBeenCalledOnce();
    expect(rollbackDevice).toHaveBeenCalledOnce();
  });
});

function setup(options: {
  prepareDevice?: () => Promise<boolean | void>;
  prepareRoom?: ReturnType<typeof vi.fn>;
  rollbackDevice?: ReturnType<typeof vi.fn>;
  clearRoom?: ReturnType<typeof vi.fn>;
  effectResult?: { status: "rejected"; errorCode: "invalid_state" };
  ledger?: TestCommandLedger;
} = {}) {
  const apply = vi.fn<VuartV1CommandEffect>().mockResolvedValue(
    options.effectResult ?? { status: "applied" },
  );
  const guard = new VuartV1CommandReplayGuard(apply);
  guard.bind(binding);
  const transport = new FixtureVuartV1CommandTransport(guard);
  const ingress = new AirDeviceGatewayCommandIngress(transport, {
    maxAttempts: 2,
    initialSequence: 10,
  });
  const prepareRoom = options.prepareRoom ?? vi.fn(async () => true);
  const observeCarrier = vi.fn(async () => null);
  const service = new AirGatewayCommandService({
    ingress,
    prepareRoom,
    prepareDevice: options.prepareDevice,
    rollbackDevice: options.rollbackDevice,
    clearRoom: options.clearRoom,
    observeCarrier,
    ledger: options.ledger,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  });
  return { apply, transport, prepareRoom, observeCarrier, service };
}

class TestCommandLedger {
  readonly records = new Map<string, Record<string, unknown>>();
  failUpsertAt = 0;
  private upserts = 0;

  async load() {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  async upsert(record: Record<string, unknown>) {
    this.upserts += 1;
    if (this.upserts === this.failUpsertAt) throw new Error("ledger unavailable");
    this.records.set(String(record.commandId), structuredClone(record));
  }

  async remove(commandId: string) {
    this.records.delete(commandId);
  }
}

function dial(overrides: Record<string, unknown> = {}) {
  return {
    type: "dial",
    providerOperationId: "operation-1",
    commandId: "command-1",
    idempotencyKey: "dial:comm-1:1",
    ...binding,
    phoneNumberReference: "+8613800138000",
    participantIdentity: "comm-1:guest:air:air-780-1",
    roomName: "call_comm-1",
    roomAccess: {
      wsUrl: "wss://livekit.example.cn",
      token: "room-token",
      expiresAt: "2026-08-04T12:05:00.000Z",
      mediaPolicy: "translation_isolated",
    },
    ...overrides,
  };
}

function reconcile() {
  return {
    type: "reconcile",
    providerOperationId: "reconcile-operation-1",
    commandId: "reconcile-command-1",
    idempotencyKey: "reconcile:comm-1:1",
    ...binding,
  };
}

const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};
