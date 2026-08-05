import type { AirDeviceHeartbeatRequest } from "@translation/contracts";

export function parseAirDeviceHeartbeatRequest(
  value: unknown,
): AirDeviceHeartbeatRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const hasBinding = input.activeBinding !== undefined;
  if (!exactKeys(input, hasBinding ? [...keys, "activeBinding"] : keys) ||
    !bounded(input.eventId, 200) || !identifier(input.deviceId, 128) ||
    !identifier(input.bootId, 128) || !identifier(input.firmwareVersion, 64) ||
    !identifier(input.protocolVersion, 32) ||
    !sampleRates(input.supportedSampleRates) || !uint32(input.heartbeatSequence) ||
    !uint64String(input.uptimeMs) ||
    !["ready", "in_call", "quarantined", "fault"]
      .includes(String(input.deviceState)) ||
    typeof input.observedAt !== "string" ||
    !Number.isFinite(Date.parse(input.observedAt)) ||
    (input.deviceState === "in_call") !== hasBinding) return null;
  if (hasBinding && !binding(input.activeBinding, input.deviceId as string)) return null;
  return input as unknown as AirDeviceHeartbeatRequest;
}

function binding(value: unknown, deviceId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return exactKeys(input, bindingKeys) &&
    identifier(input.communicationSessionId, 160) &&
    identifier(input.providerCallId, 200) && input.deviceId === deviceId &&
    identifier(input.leaseId, 128) &&
    Number.isSafeInteger(input.fencingToken) && Number(input.fencingToken) > 0 &&
    uint32(input.callGeneration);
}

function sampleRates(value: unknown): value is Array<8_000 | 16_000> {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2 &&
    new Set(value).size === value.length &&
    value.every((rate) => rate === 8_000 || rate === 16_000);
}

function uint64String(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value)) return false;
  try {
    return BigInt(value) <= 0xffffffffffffffffn;
  } catch {
    return false;
  }
}

function identifier(value: unknown, maximum: number): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]+$/.test(value) &&
    Buffer.byteLength(value) <= maximum;
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function uint32(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff;
}

function exactKeys(value: object, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

const keys = ["eventId", "deviceId", "bootId", "firmwareVersion",
  "protocolVersion", "supportedSampleRates", "heartbeatSequence", "uptimeMs",
  "deviceState", "observedAt"];
const bindingKeys = ["communicationSessionId", "providerCallId", "deviceId",
  "leaseId", "fencingToken", "callGeneration"];
