import { describe, expect, it } from "vitest";
import {
  airGatewayHardwareRuntimeConfig,
  loadAirGatewayHardwareRuntimeConfig,
} from "./runtime-target.js";

const stableVuartPath =
  "/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_000000000001-if06";

describe("Air Gateway hardware runtime target", () => {
  it("accepts only an explicitly enabled Beelink Linux by-id VUART", () => {
    expect(airGatewayHardwareRuntimeConfig({
      platform: "linux",
      env: hardwareEnv(),
    })).toEqual({
      deploymentTarget: "beelink",
      serialPath: stableVuartPath,
    });
  });

  it("fails closed when hardware access was not explicitly enabled", () => {
    expect(() => airGatewayHardwareRuntimeConfig({
      platform: "linux",
      env: hardwareEnv({ AIR_GATEWAY_HARDWARE_ENABLED: undefined }),
    })).toThrow("hardware access is disabled");
    expect(() => airGatewayHardwareRuntimeConfig({
      platform: "linux",
      env: hardwareEnv({ AIR_GATEWAY_HARDWARE_ENABLED: "false" }),
    })).toThrow("hardware access is disabled");
  });

  it("rejects macOS even when all hardware variables are present", () => {
    expect(() => airGatewayHardwareRuntimeConfig({
      platform: "darwin",
      env: hardwareEnv(),
    })).toThrow("requires Linux");
  });

  it("rejects any deployment target other than Beelink", () => {
    expect(() => airGatewayHardwareRuntimeConfig({
      platform: "linux",
      env: hardwareEnv({ AIR_GATEWAY_DEPLOYMENT_TARGET: "mac" }),
    })).toThrow("target must be beelink");
  });

  it("rejects unstable tty aliases", () => {
    expect(() => airGatewayHardwareRuntimeConfig({
      platform: "linux",
      env: hardwareEnv({ AIR_GATEWAY_SERIAL_PATH: "/dev/ttyACM2" }),
    })).toThrow("stable AirM2M by-id");
  });

  it("rejects AirM2M log interfaces instead of the user VUART", () => {
    expect(() => airGatewayHardwareRuntimeConfig({
      platform: "linux",
      env: hardwareEnv({
        AIR_GATEWAY_SERIAL_PATH:
          "/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_000000000001-if04",
      }),
    })).toThrow("if06");
  });

  it("uses the actual host platform when loading production environment", () => {
    const load = () => loadAirGatewayHardwareRuntimeConfig(hardwareEnv());
    if (process.platform === "linux") {
      expect(load()).toEqual({
        deploymentTarget: "beelink",
        serialPath: stableVuartPath,
      });
    } else {
      expect(load).toThrow("requires Linux");
    }
  });
});

function hardwareEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    AIR_GATEWAY_HARDWARE_ENABLED: "true",
    AIR_GATEWAY_DEPLOYMENT_TARGET: "beelink",
    AIR_GATEWAY_SERIAL_PATH: stableVuartPath,
    ...overrides,
  };
}
