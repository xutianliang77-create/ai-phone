import type { PoolClient } from "pg";
import type {
  AirDeviceHeartbeatRequest,
  AirDeviceRegistrationDto,
} from "@translation/contracts";
import { DeviceLeaseConflict } from "./device-lease-registry.js";

interface AirDeviceHeartbeatResult {
  registration: AirDeviceRegistrationDto;
  leaseRenewed: boolean;
}

export class AirDeviceHeartbeatService {
  constructor(private readonly dependencies: {
    registry: {
      processHeartbeat(
        client: Pick<PoolClient, "query">,
        input: AirDeviceHeartbeatRequest & { leaseTtlSeconds: number },
      ): Promise<AirDeviceHeartbeatResult>;
    };
    inbox: {
      claim(input: {
        eventId: string;
        sessionId: string;
        eventType: string;
        payload: unknown;
        claimOwner: string;
        leaseSeconds: number;
      }): Promise<{ duplicate: boolean; result: unknown }>;
      completeClaim(input: {
        eventId: string;
        claimOwner: string;
        result: AirDeviceHeartbeatResult;
        beforeComplete: (
          client: Pick<PoolClient, "query">,
        ) => Promise<void>;
      }): Promise<unknown>;
      abandon(eventId: string, claimOwner: string): Promise<unknown>;
    };
    leaseTtlSeconds: number;
    claimOwner: string;
  }) {}

  async process(input: AirDeviceHeartbeatRequest) {
    if ((input.deviceState === "in_call") !== Boolean(input.activeBinding) ||
      Boolean(input.activeBinding && input.activeBinding.deviceId !== input.deviceId)) {
      throw new DeviceLeaseConflict("Heartbeat call binding is invalid");
    }
    const claim = await this.dependencies.inbox.claim({
      eventId: input.eventId,
      sessionId: input.deviceId,
      eventType: "device.heartbeat",
      payload: input,
      claimOwner: this.dependencies.claimOwner,
      leaseSeconds: 30,
    });
    if (claim.duplicate) return requireHeartbeatResult(claim.result);

    const result = {} as AirDeviceHeartbeatResult;
    try {
      await this.dependencies.inbox.completeClaim({
        eventId: input.eventId,
        claimOwner: this.dependencies.claimOwner,
        result,
        beforeComplete: async (client) => {
          Object.assign(result, await this.dependencies.registry.processHeartbeat(
            client,
            { ...input, leaseTtlSeconds: this.dependencies.leaseTtlSeconds },
          ));
        },
      });
      return requireHeartbeatResult(result);
    } catch (error) {
      await this.dependencies.inbox.abandon(
        input.eventId,
        this.dependencies.claimOwner,
      ).catch(() => undefined);
      throw error;
    }
  }
}

function requireHeartbeatResult(value: unknown): AirDeviceHeartbeatResult {
  const result = value as Partial<AirDeviceHeartbeatResult> | null;
  if (!result || typeof result.leaseRenewed !== "boolean" ||
    !result.registration || typeof result.registration !== "object" ||
    typeof result.registration.deviceId !== "string") {
    throw new Error("Invalid Air device heartbeat result");
  }
  return result as AirDeviceHeartbeatResult;
}
