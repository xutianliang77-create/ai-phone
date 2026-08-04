import { describe, expect, it } from "vitest";
import { AirDeviceCommandError, SimulatedAirDevice } from "./simulated-air-device.js";

describe("simulated Air device", () => {
  it("executes a dial command exactly once and replays its result", () => {
    const device = new SimulatedAirDevice("air-001");
    device.bindLease({ leaseId: "lease-1", fencingToken: 4 });
    const command = {
      commandId: "cmd-1",
      leaseId: "lease-1",
      fencingToken: 4,
      type: "dial" as const,
      phoneNumberReference: "+8613800138000",
    };

    const first = device.execute(command);
    const replay = device.execute(command);

    expect(replay).toEqual(first);
    expect(first.state).toBe("dialing");
    expect(device.events()).toHaveLength(1);
  });

  it("rejects stale fencing tokens", () => {
    const device = new SimulatedAirDevice("air-001");
    device.bindLease({ leaseId: "lease-2", fencingToken: 8 });

    expect(() => device.execute({
      commandId: "cmd-stale",
      leaseId: "lease-1",
      fencingToken: 7,
      type: "hangup",
    })).toThrow(AirDeviceCommandError);
    expect(device.state()).toBe("ready");
  });

  it("uses carrier events as the authoritative call state", () => {
    const device = new SimulatedAirDevice("air-001");
    device.bindLease({ leaseId: "lease-1", fencingToken: 1 });
    device.execute({
      commandId: "dial-1",
      leaseId: "lease-1",
      fencingToken: 1,
      type: "dial",
      phoneNumberReference: "+8613800138000",
    });

    device.observeCarrierState("ringing");
    device.observeCarrierState("connected");
    expect(device.state()).toBe("connected");
  });

  it("does not promote carrier state when the LiveKit participant joins", () => {
    const device = new SimulatedAirDevice("air-001");
    device.bindLease({ leaseId: "lease-1", fencingToken: 1 });
    device.execute({
      commandId: "dial-1",
      leaseId: "lease-1",
      fencingToken: 1,
      type: "dial",
      phoneNumberReference: "+8613800138000",
    });

    device.observeLiveKitParticipant("joined");
    expect(device.state()).toBe("dialing");
    expect(device.liveKitParticipantState()).toBe("joined");
    device.observeCarrierState("connected");
    expect(device.state()).toBe("connected");
  });

  it("rejects the same commandId with a different payload", () => {
    const device = new SimulatedAirDevice("air-001");
    device.bindLease({ leaseId: "lease-1", fencingToken: 1 });
    device.execute({
      commandId: "dial-1",
      leaseId: "lease-1",
      fencingToken: 1,
      type: "dial",
      phoneNumberReference: "+8613800138000",
    });

    expect(() => device.execute({
      commandId: "dial-1",
      leaseId: "lease-1",
      fencingToken: 1,
      type: "dial",
      phoneNumberReference: "+8613900139000",
    })).toThrowError(expect.objectContaining({ code: "conflict" }));
    expect(device.events()).toHaveLength(1);
  });
});
