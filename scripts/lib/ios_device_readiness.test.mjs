import { describe, expect, test } from "vitest";
import {
  buildDiagnostic,
  isReadyForSmoke,
  matchesDevice,
  remediationActions,
} from "./ios_device_readiness.mjs";

describe("iOS device readiness", () => {
  test("accepts a paired Developer Mode iPhone with an active tunnel", () => {
    const device = fakeDevice();

    expect(isReadyForSmoke(device)).toBe(true);
    expect(remediationActions(device)).toEqual([]);
    expect(buildDiagnostic([device], [device], "Wha的iPhone")).toMatchObject({
      ready: true,
      physicalDeviceCount: 1,
      matchedDeviceCount: 1,
      devices: [{ ready: true, matched: true }],
    });
  });

  test("reports the current blocker when Developer Mode and tunnel are missing", () => {
    const device = fakeDevice({
      developerModeStatus: "disabled",
      tunnelState: "unavailable",
    });
    const diagnostic = buildDiagnostic([device], [device], "Wha的iPhone");

    expect(diagnostic.ready).toBe(false);
    expect(diagnostic.devices[0]).toMatchObject({
      developerModeStatus: "disabled",
      tunnelState: "unavailable",
      ready: false,
    });
    expect(diagnostic.devices[0].actions).toContain(
      "enable iOS Developer Mode on the iPhone, then reconnect it.",
    );
    expect(diagnostic.devices[0].actions).toContain(
      "keep the iPhone unlocked and connected by cable, or enable same-LAN wireless development.",
    );
  });

  test("matches device selection by name, identifier, UDID, or hostname", () => {
    const device = fakeDevice();

    expect(matchesDevice(device, "Wha的iPhone")).toBe(true);
    expect(matchesDevice(device, "device-identifier")).toBe(true);
    expect(matchesDevice(device, "device-udid")).toBe(true);
    expect(matchesDevice(device, "wha-iphone.local")).toBe(true);
    expect(matchesDevice(device, "other-phone")).toBe(false);
  });

  test("rejects unsupported iOS versions for FluidAudio/CoreML Nemotron", () => {
    const device = fakeDevice({ osVersionNumber: "16.7.9" });

    expect(isReadyForSmoke(device)).toBe(false);
    expect(remediationActions(device)).toContain(
      "use an iPhone running iOS 17.0 or newer for FluidAudio/CoreML Nemotron.",
    );
  });
});

function fakeDevice(overrides = {}) {
  return {
    identifier: overrides.identifier ?? "device-identifier",
    deviceProperties: {
      name: overrides.name ?? "Wha的iPhone",
      osVersionNumber: overrides.osVersionNumber ?? "26.3",
      developerModeStatus: overrides.developerModeStatus ?? "enabled",
    },
    hardwareProperties: {
      platform: "iOS",
      reality: "physical",
      marketingName: overrides.marketingName ?? "iPhone 13 Pro Max",
      udid: overrides.udid ?? "device-udid",
    },
    connectionProperties: {
      pairingState: overrides.pairingState ?? "paired",
      tunnelState: overrides.tunnelState ?? "connected",
      lastConnectionDate: overrides.lastConnectionDate ?? "2026-06-27T16:00:00.000Z",
      potentialHostnames: [overrides.hostname ?? "wha-iphone.local"],
    },
  };
}
