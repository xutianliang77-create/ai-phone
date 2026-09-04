import {
  airGatewayHardwareRuntimeConfig,
  type AirGatewayHardwareRuntimeConfig,
} from "./runtime-target.js";
import { isAbsolute, resolve } from "node:path";

export interface AirGatewayDaemonConfig {
  hardware: AirGatewayHardwareRuntimeConfig;
  deviceId: string;
  host: string;
  port: number;
  commandApiSecret: string;
  apiBaseUrl: string;
  eventApiSecret: string;
  commandLedgerPath: string;
  eventOutboxDirectory: string;
  commandTimeoutMs: number;
  responseTimeoutMs: number;
  heartbeatTimeoutMs: number;
  maxInFlightCommands: number;
  maxCommandRecords: number;
}

export function airGatewayDaemonConfig(input: {
  platform: string;
  env: Record<string, string | undefined>;
}): AirGatewayDaemonConfig {
  const hardware = airGatewayHardwareRuntimeConfig(input);
  const deviceId = input.env.AIR_GATEWAY_DEVICE_ID?.trim() ?? "";
  const host = input.env.AIR_GATEWAY_LISTEN_HOST?.trim() || "127.0.0.1";
  const port = integer(input.env.AIR_GATEWAY_PORT, 8_780, 1, 65_535,
    "AIR_GATEWAY_PORT");
  const commandApiSecret = secret(
    input.env.AIR_DEVICE_GATEWAY_API_SECRET,
    "Air Gateway command secret",
  );
  const apiBaseUrl = secureBaseUrl(input.env.AIR_GATEWAY_API_BASE_URL);
  const eventApiSecret = secret(
    input.env.AIR_DEVICE_GATEWAY_EVENT_SECRET,
    "Air Gateway event secret",
  );
  const commandLedgerPath = input.env.AIR_GATEWAY_COMMAND_LEDGER_PATH?.trim() ?? "";
  const eventOutboxDirectory =
    input.env.AIR_GATEWAY_EVENT_OUTBOX_DIRECTORY?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId)) {
    throw new Error("AIR_GATEWAY_DEVICE_ID is invalid");
  }
  if (!validHost(host)) throw new Error("AIR_GATEWAY_LISTEN_HOST is invalid");
  if (!apiBaseUrl) throw new Error("Air Gateway API base URL is invalid");
  if (!isAbsolute(commandLedgerPath) || resolve(commandLedgerPath) === "/" ||
    commandLedgerPath.length > 1_024) {
    throw new Error("Air Gateway command ledger path is invalid");
  }
  if (!isAbsolute(eventOutboxDirectory) || resolve(eventOutboxDirectory) === "/" ||
    eventOutboxDirectory.length > 1_024) {
    throw new Error("Air Gateway event outbox directory is invalid");
  }
  if (commandApiSecret === eventApiSecret) {
    throw new Error("Air Gateway command and event secrets must differ");
  }
  return {
    hardware,
    deviceId,
    host,
    port,
    commandApiSecret,
    apiBaseUrl,
    eventApiSecret,
    commandLedgerPath: resolve(commandLedgerPath),
    eventOutboxDirectory: resolve(eventOutboxDirectory),
    commandTimeoutMs: integer(input.env.AIR_GATEWAY_COMMAND_TIMEOUT_MS,
      5_000, 500, 30_000, "AIR_GATEWAY_COMMAND_TIMEOUT_MS"),
    responseTimeoutMs: integer(input.env.AIR_GATEWAY_RESPONSE_TIMEOUT_MS,
      2_000, 100, 10_000, "AIR_GATEWAY_RESPONSE_TIMEOUT_MS"),
    heartbeatTimeoutMs: integer(input.env.AIR_GATEWAY_HEARTBEAT_TIMEOUT_MS,
      15_000, 1_000, 60_000, "AIR_GATEWAY_HEARTBEAT_TIMEOUT_MS"),
    maxInFlightCommands: integer(input.env.AIR_GATEWAY_MAX_IN_FLIGHT_COMMANDS,
      64, 1, 1_024, "AIR_GATEWAY_MAX_IN_FLIGHT_COMMANDS"),
    maxCommandRecords: integer(input.env.AIR_GATEWAY_MAX_COMMAND_RECORDS,
      1_024, 1, 100_000, "AIR_GATEWAY_MAX_COMMAND_RECORDS"),
  };
}

export function loadAirGatewayDaemonConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return airGatewayDaemonConfig({ platform: process.platform, env });
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be ${minimum}-${maximum}`);
  }
  return parsed;
}

function secret(value: string | undefined, name: string) {
  const normalized = value?.trim() ?? "";
  if (Buffer.byteLength(normalized) < 32) {
    throw new Error(`${name} must be at least 32 bytes`);
  }
  return normalized;
}

function secureBaseUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"]
      .includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function validHost(value: string) {
  return value === "localhost" || /^[A-Za-z0-9.:[\]-]{1,253}$/.test(value);
}
