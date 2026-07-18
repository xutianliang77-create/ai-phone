import { RoomServiceClient, TwirpError } from "livekit-server-sdk";
import type { LiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import {
  isLiveKitAlreadyExistsError,
  liveKitApiUrl,
} from "../call-links/livekit-room-provider-adapter.js";

interface ConsultRoomClient {
  createRoom(options: {
    name: string;
    emptyTimeout: number;
    maxParticipants: number;
  }): Promise<unknown>;
  listParticipants(roomName: string): Promise<Array<{ identity?: string }>>;
  moveParticipant(roomName: string, identity: string, destinationRoom: string): Promise<void>;
  removeParticipant(roomName: string, identity: string): Promise<unknown>;
  deleteRoom(roomName: string): Promise<unknown>;
}

export class LiveKitAgentConsultRoom {
  private readonly client: ConsultRoomClient;

  constructor(
    private readonly config: LiveKitRoomConfig,
    client?: ConsultRoomClient,
  ) {
    this.client = client ?? new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async ensure(roomName: string) {
    try {
      await this.client.createRoom({
        name: roomName,
        emptyTimeout: Math.min(300, this.config.resourceLimits.emptyTimeoutSeconds),
        maxParticipants: 2,
      });
      return success();
    } catch (error) {
      return isLiveKitAlreadyExistsError(error) ? success() : failure(error, false);
    }
  }

  async presence(roomName: string, identities: string[]) {
    try {
      const present = new Set((await this.client.listParticipants(roomName))
        .flatMap((participant) => participant.identity ? [participant.identity] : []));
      return { ...success(), present: identities.filter((identity) => present.has(identity)) };
    } catch (error) {
      return isNotFound(error) ? { ...success(), present: [] } : failure(error, false);
    }
  }

  async move(roomName: string, identity: string, destinationRoom: string) {
    try {
      await this.client.moveParticipant(roomName, identity, destinationRoom);
      return success();
    } catch (error) {
      return failure(error, true);
    }
  }

  async remove(roomName: string, identity: string) {
    try {
      await this.client.removeParticipant(roomName, identity);
      return success();
    } catch (error) {
      return isNotFound(error) ? success() : failure(error, true);
    }
  }

  async delete(roomName: string) {
    try {
      await this.client.deleteRoom(roomName);
      return success();
    } catch (error) {
      return isNotFound(error) ? success() : failure(error, true);
    }
  }
}

function success() {
  return { ok: true as const };
}

function failure(error: unknown, sideEffectStarted: boolean) {
  const errorClass = classify(error);
  return {
    ok: false as const,
    errorClass,
    retryable: ["timeout", "rate_limited", "unavailable"].includes(errorClass),
    reconciliationRequired: sideEffectStarted &&
      ["timeout", "rate_limited", "unavailable", "conflict"].includes(errorClass),
  };
}

function classify(error: unknown) {
  if (error instanceof TwirpError) {
    if (error.status === 400) return "invalid_request" as const;
    if ([401, 403].includes(error.status)) return "unauthorized" as const;
    if (error.status === 404) return "not_found" as const;
    if (error.status === 409) return "conflict" as const;
    if (error.status === 429) return "rate_limited" as const;
  }
  if (error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)) return "timeout" as const;
  return "unavailable" as const;
}

function isNotFound(error: unknown) {
  return error instanceof TwirpError && error.status === 404;
}
