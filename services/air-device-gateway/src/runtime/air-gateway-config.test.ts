import { describe, expect, it } from "vitest";
import { airGatewayDaemonConfig } from "./air-gateway-config.js";

describe("Air Gateway daemon config", () => {
  it("loads only an explicit Beelink hardware and authenticated API profile", () => {
    expect(airGatewayDaemonConfig({ platform: "linux", env: validEnv }))
      .toEqual(expect.objectContaining({
        hardware: {
          deploymentTarget: "beelink",
          serialPath: "/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_0001-if06",
        },
        deviceId: "air-780-1",
        host: "127.0.0.1",
        port: 8780,
        apiBaseUrl: "https://api.example.cn",
        commandLedgerPath: "/var/lib/ai-phone-air-gateway/commands.json",
        eventOutboxDirectory: "/var/lib/ai-phone-air-gateway/events",
        commandTimeoutMs: 5_000,
      }));
  });

  it("fails closed without hardware enable or strong independent secrets", () => {
    expect(() => airGatewayDaemonConfig({
      platform: "linux",
      env: { ...validEnv, AIR_GATEWAY_HARDWARE_ENABLED: "false" },
    })).toThrow("hardware access is disabled");
    expect(() => airGatewayDaemonConfig({
      platform: "linux",
      env: { ...validEnv, AIR_DEVICE_GATEWAY_EVENT_SECRET: "short" },
    })).toThrow("event secret");
  });

  it("rejects cleartext non-loopback API endpoints", () => {
    expect(() => airGatewayDaemonConfig({
      platform: "linux",
      env: { ...validEnv, AIR_GATEWAY_API_BASE_URL: "http://192.168.1.20:8787" },
    })).toThrow("API base URL");
  });

  it("requires an absolute durable command ledger path", () => {
    expect(() => airGatewayDaemonConfig({
      platform: "linux",
      env: { ...validEnv, AIR_GATEWAY_COMMAND_LEDGER_PATH: "commands.json" },
    })).toThrow("ledger path");
    expect(() => airGatewayDaemonConfig({
      platform: "linux",
      env: { ...validEnv, AIR_GATEWAY_EVENT_OUTBOX_DIRECTORY: "events" },
    })).toThrow("outbox directory");
  });
});

const validEnv = {
  AIR_GATEWAY_HARDWARE_ENABLED: "true",
  AIR_GATEWAY_DEPLOYMENT_TARGET: "beelink",
  AIR_GATEWAY_SERIAL_PATH:
    "/dev/serial/by-id/usb-AirM2M_AirM2M_Compo_0001-if06",
  AIR_GATEWAY_DEVICE_ID: "air-780-1",
  AIR_GATEWAY_LISTEN_HOST: "127.0.0.1",
  AIR_GATEWAY_PORT: "8780",
  AIR_DEVICE_GATEWAY_API_SECRET: "command-secret-12345678901234567890",
  AIR_GATEWAY_API_BASE_URL: "https://api.example.cn",
  AIR_GATEWAY_COMMAND_LEDGER_PATH: "/var/lib/ai-phone-air-gateway/commands.json",
  AIR_GATEWAY_EVENT_OUTBOX_DIRECTORY: "/var/lib/ai-phone-air-gateway/events",
  AIR_DEVICE_GATEWAY_EVENT_SECRET: "event-secret-123456789012345678901",
  AIR_GATEWAY_COMMAND_TIMEOUT_MS: "5000",
};
