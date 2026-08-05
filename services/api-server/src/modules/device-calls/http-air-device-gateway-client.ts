import type {
  AirDeviceGatewayClient,
  DeviceCommandBinding,
} from "./air780-device-provider-adapter.js";
import type { AirDeviceGatewayConfig } from
  "./air-device-gateway-readiness.js";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class DeviceCommandRejected extends Error {
  constructor() {
    super("Air device command was rejected");
    this.name = "DeviceCommandRejected";
  }
}

export class HttpAirDeviceGatewayClient implements AirDeviceGatewayClient {
  constructor(
    private readonly config: AirDeviceGatewayConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async dial(input: Parameters<AirDeviceGatewayClient["dial"]>[0]) {
    const result = await this.command({ type: "dial", ...input });
    if (result.providerCallId !== input.providerCallId) {
      throw new DeviceCommandRejected();
    }
    return { providerCallId: input.providerCallId, state: "dialing" as const };
  }

  async hangup(input: Parameters<AirDeviceGatewayClient["hangup"]>[0]) {
    await this.command({ type: "hangup", ...input });
    return { state: "ending" as const };
  }

  async sendDtmf(input: Parameters<AirDeviceGatewayClient["sendDtmf"]>[0]) {
    await this.command({ type: "dtmf", ...input });
    return { state: "active" as const };
  }

  async reconcile(input: Parameters<AirDeviceGatewayClient["reconcile"]>[0]) {
    const result = await this.command({ type: "reconcile", ...input });
    if (result.status !== "observed" || !isPhoneState(result.state)) {
      throw new Error("Air device reconciliation response is invalid");
    }
    return {
      state: result.state,
      ...(validTimestamp(result.observedAt)
        ? { observedAt: result.observedAt }
        : {}),
    };
  }

  private async command(input: Record<string, unknown>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.config.baseUrl}/v1/device-commands`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiSecret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        },
      );
      const result = await parseResponse(response);
      if (result.status === "timeout_reconcile_required") {
        throw namedError("TimeoutError", "Air device command needs reconciliation");
      }
      if (result.status === "unavailable" &&
        ["command_ledger_failed", "room_not_ready"].includes(
          String(result.reason),
        )) {
        throw namedError(
          "DeviceCommandNotDispatched",
          "Air device command was not dispatched",
        );
      }
      if (["blocked", "error", "overloaded"].includes(String(result.status)) ||
        (!response.ok && response.status < 500)) {
        throw new DeviceCommandRejected();
      }
      if (!response.ok || !["ack", "observed"].includes(String(result.status))) {
        throw new Error("Air device Gateway is unavailable");
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw namedError("TimeoutError", "Air device Gateway timed out");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (Buffer.byteLength(text) > 8_192) {
    throw new Error("Air device Gateway response is too large");
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Air device Gateway response is invalid");
  }
}

function namedError(name: string, message: string) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function isPhoneState(value: unknown): value is
  "dialing" | "ringing" | "connected" | "media_ready" | "active" |
  "ending" | "completed" | "failed" | "unknown" {
  return typeof value === "string" && [
    "dialing", "ringing", "connected", "media_ready", "active", "ending",
    "completed", "failed", "unknown",
  ].includes(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export type AirDeviceGatewayCommandBinding = DeviceCommandBinding;
