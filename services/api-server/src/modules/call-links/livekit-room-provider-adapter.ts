import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import type {
  MediaRoomProvider,
  ProviderAdapterRequest,
  ProviderAdapterResult,
} from "@translation/contracts";
import type { LiveKitRoomConfig } from "./call-room-readiness.js";

interface LiveKitRoomApiClient {
  createRoom(options: {
    name: string;
    emptyTimeout: number;
    maxParticipants: number;
  }): Promise<unknown>;
  listParticipants(roomName: string): Promise<Array<{ identity?: string }>>;
  removeParticipant(roomName: string, participantIdentity: string): Promise<unknown>;
  sendData(
    roomName: string,
    data: Uint8Array,
    kind: DataPacket_Kind,
    options: { topic: string; destinationIdentities?: string[] },
  ): Promise<unknown>;
}

export class LiveKitRoomProviderAdapter implements MediaRoomProvider {
  private readonly client: LiveKitRoomApiClient;
  private readonly ensuredRooms = new Set<string>();

  constructor(
    private readonly config: LiveKitRoomConfig,
    client?: LiveKitRoomApiClient,
  ) {
    this.client = client ?? new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async ensureRoom(request: ProviderAdapterRequest<{ roomName: string }>):
    Promise<ProviderAdapterResult<{ roomName: string }>> {
    const roomName = request.payload.roomName;
    if (this.ensuredRooms.has(roomName)) return success(roomName);
    try {
      await this.client.createRoom({
        name: roomName,
        emptyTimeout: this.config.resourceLimits.emptyTimeoutSeconds,
        maxParticipants: this.config.resourceLimits.maxParticipants,
      });
    } catch (error) {
      if (!isLiveKitAlreadyExistsError(error)) return failure(error);
    }
    this.ensuredRooms.add(roomName);
    return success(roomName);
  }

  async hasParticipant(roomName: string, participantIdentity: string) {
    const participants = await this.client.listParticipants(roomName);
    return participants.some(
      (participant) => participant.identity === participantIdentity,
    );
  }

  async listParticipantIdentities(roomName: string) {
    const participants = await this.client.listParticipants(roomName);
    return participants.flatMap(
      (participant) => participant.identity ? [participant.identity] : [],
    );
  }

  async removeParticipant(roomName: string, participantIdentity: string) {
    await this.client.removeParticipant(roomName, participantIdentity);
  }

  async publish(
    roomName: string,
    data: Uint8Array,
    topic: string,
    destinationIdentities?: string[],
  ) {
    await this.client.sendData(
      roomName,
      data,
      DataPacket_Kind.RELIABLE,
      { topic, ...(destinationIdentities ? { destinationIdentities } : {}) },
    );
  }
}

function success(roomName: string): ProviderAdapterResult<{ roomName: string }> {
  return {
    ok: true,
    provider: "livekit",
    externalResourceId: roomName,
    capabilities: ["room", "publish_audio", "subscribe_audio"],
    result: { roomName },
  };
}

function failure(error: unknown): ProviderAdapterResult<never> {
  const value = error as { status?: unknown; code?: unknown };
  const errorClass = value.status === 429 || value.code === "rate_limited"
    ? "rate_limited"
    : value.status === 401 || value.status === 403
    ? "unauthorized"
    : "unavailable";
  return {
    ok: false,
    provider: "livekit",
    errorClass,
    retryable: errorClass === "rate_limited" || errorClass === "unavailable",
    reconciliationRequired: false,
  };
}

export function liveKitApiUrl(livekitUrl: string) {
  const url = new URL(livekitUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  return url.toString().replace(/\/$/, "");
}

export function isLiveKitAlreadyExistsError(error: unknown) {
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  return candidate.code === "already_exists" ||
    candidate.status === 409 ||
    (
      typeof candidate.message === "string" &&
      candidate.message.toLowerCase().includes("already exists")
    );
}
