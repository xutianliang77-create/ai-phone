import { describe, expect, it, vi } from "vitest";
import {
  AirDeviceGatewayCommandIngress,
} from "./vuart-v1-command-ingress.js";
import {
  FixtureVuartV1CommandTransport,
} from "./vuart-v1-command-transport-fixture.js";
import {
  VuartV1CommandReplayGuard,
  type VuartV1CommandEffect,
} from "./vuart-v1-command-replay-guard.js";
import type { VuartV1DeviceCommand } from "./vuart-v1-command-payload.js";

const binding = {
  communicationSessionId: "comm-1",
  providerCallId: "air-call-1",
  deviceId: "air-780-1",
  leaseId: "lease-1",
  fencingToken: 7,
  callGeneration: 3,
};

function dial(overrides: Partial<VuartV1DeviceCommand> = {}): VuartV1DeviceCommand {
  return {
    ...binding,
    providerOperationId: "operation-1",
    commandId: "command-1",
    idempotencyKey: "air-command:comm-1:3:1",
    type: "dial",
    dialTargetE164: "+8613800138000",
    ...overrides,
  } as VuartV1DeviceCommand;
}

function setup(effect: VuartV1CommandEffect, maxAttempts = 2) {
  const guard = new VuartV1CommandReplayGuard(effect);
  guard.bind(binding);
  const transport = new FixtureVuartV1CommandTransport(guard);
  const ingress = new AirDeviceGatewayCommandIngress(transport, {
    maxAttempts,
    initialSequence: 100,
    nowMs: () => 1_000n,
  });
  return { guard, transport, ingress };
}

describe("Air Gateway VUART command ingress and replay guard", () => {
  it("replays after one lost ACK while applying the side effect exactly once", async () => {
    const apply = vi.fn<VuartV1CommandEffect>().mockResolvedValue({ status: "applied" });
    const { guard, transport, ingress } = setup(apply);
    transport.dropNextResponses(1);

    const result = await ingress.execute(dial());

    expect(result).toMatchObject({ status: "ack", attempts: 2,
      ack: { commandId: "command-1", result: "applied" } });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(transport.requests()).toHaveLength(2);
    expect(transport.requests()[1]).toEqual(transport.requests()[0]);
    expect(guard.metrics()).toMatchObject({ commandsApplied: 1, ackReplays: 1 });
  });

  it("rejects commandId and idempotencyKey payload conflicts without a second effect", async () => {
    const apply = vi.fn<VuartV1CommandEffect>().mockResolvedValue({ status: "applied" });
    const { ingress } = setup(apply);
    expect(await ingress.execute(dial())).toMatchObject({ status: "ack" });

    expect(await ingress.execute(dial({
      dialTargetE164: "+8613900139000",
    }))).toMatchObject({ status: "error",
      error: { errorCode: "idempotency_conflict" } });
    expect(await ingress.execute(dial({
      commandId: "command-2",
    }))).toMatchObject({ status: "error",
      error: { errorCode: "idempotency_conflict" } });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("rejects every stale fence and generation before any side effect", async () => {
    const apply = vi.fn<VuartV1CommandEffect>().mockResolvedValue({ status: "applied" });
    const { guard, ingress } = setup(apply);
    let checked = 0;

    for (let staleFence = 1; staleFence < binding.fencingToken; staleFence += 1) {
      const result = await ingress.execute(dial({
        fencingToken: staleFence,
        commandId: `stale-fence-${staleFence}`,
        idempotencyKey: `stale-fence-key-${staleFence}`,
      }));
      expect(result).toMatchObject({ status: "error",
        error: { errorCode: "stale_fence" } });
      checked += 1;
    }
    for (let staleGeneration = 0;
      staleGeneration < binding.callGeneration;
      staleGeneration += 1) {
      const result = await ingress.execute(dial({
        callGeneration: staleGeneration,
        commandId: `stale-generation-${staleGeneration}`,
        idempotencyKey: `stale-generation-key-${staleGeneration}`,
      }));
      expect(result).toMatchObject({ status: "error",
        error: { errorCode: "stale_generation" } });
      checked += 1;
    }

    expect(checked).toBe(9);
    expect(apply).not.toHaveBeenCalled();
    expect(guard.metrics()).toMatchObject({ staleFences: 6, staleGenerations: 3 });
  });

  it("keeps one in-flight effect for concurrent duplicate requests", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const apply = vi.fn<VuartV1CommandEffect>().mockImplementation(async () => {
      await blocked;
      return { status: "applied" };
    });
    const { ingress } = setup(apply);

    const first = ingress.execute(dial());
    const second = ingress.execute(dial());
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    release();

    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ status: "ack" }),
      expect.objectContaining({ status: "ack" }),
    ]);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("returns reconcile-required after all ACKs are lost without creating another dial", async () => {
    const apply = vi.fn<VuartV1CommandEffect>().mockResolvedValue({ status: "applied" });
    const { transport, ingress } = setup(apply, 2);
    transport.dropNextResponses(2);

    const result = await ingress.execute(dial());

    expect(result).toEqual({ status: "timeout_reconcile_required",
      commandId: "command-1", attempts: 2 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(new Set(transport.requests().map((request) => request.sequence)).size).toBe(1);
  });

  it("bounds unique in-flight commands while still coalescing an exact duplicate", async () => {
    let release!: (value: null) => void;
    const transport = {
      exchange: vi.fn().mockImplementation(() =>
        new Promise<null>((resolve) => { release = resolve; })),
    };
    const ingress = new AirDeviceGatewayCommandIngress(transport, {
      maxAttempts: 1,
      maxInFlightCommands: 1,
    });

    const first = ingress.execute(dial());
    const duplicate = ingress.execute(dial());
    await vi.waitFor(() => expect(transport.exchange).toHaveBeenCalledTimes(1));
    expect(await ingress.execute(dial({
      providerOperationId: "operation-2",
      commandId: "command-2",
      idempotencyKey: "air-command:comm-1:3:2",
    }))).toEqual({ status: "overloaded", reason: "pending_limit", attempts: 0 });
    expect(ingress.metrics()).toMatchObject({ pendingCommands: 1,
      peakPendingCommands: 1, capacityRejections: 1, coalescedRequests: 1 });

    release(null);
    expect(await Promise.all([first, duplicate])).toEqual([
      { status: "timeout_reconcile_required", commandId: "command-1", attempts: 1 },
      { status: "timeout_reconcile_required", commandId: "command-1", attempts: 1 },
    ]);
  });

  it("bounds the device replay ledger without evicting an applied command", async () => {
    const apply = vi.fn<VuartV1CommandEffect>().mockResolvedValue({ status: "applied" });
    const guard = new VuartV1CommandReplayGuard(apply, { maxRecords: 1 });
    guard.bind(binding);
    const transport = new FixtureVuartV1CommandTransport(guard);
    const ingress = new AirDeviceGatewayCommandIngress(transport, {
      maxAttempts: 1,
      initialSequence: 100,
    });

    expect(await ingress.execute(dial())).toMatchObject({ status: "ack" });
    expect(await ingress.execute(dial({
      providerOperationId: "operation-2",
      commandId: "command-2",
      idempotencyKey: "air-command:comm-1:3:2",
    }))).toMatchObject({ status: "error",
      error: { errorCode: "internal_error" } });
    const restoredIngress = new AirDeviceGatewayCommandIngress(transport, {
      maxAttempts: 1,
      initialSequence: 100,
    });
    expect(await restoredIngress.execute(dial())).toMatchObject({ status: "ack" });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(guard.metrics()).toMatchObject({ ledgerRecords: 1,
      pendingCommands: 0, ledgerCapacityRejections: 1, responseReplays: 1 });
  });
});
