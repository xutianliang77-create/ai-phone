import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import {
  encodeTranslationCallControl,
  translationCallControlTopic,
  type TranslationCallControlCommand,
} from "@translation/contracts";
import type { LiveKitRoomConfig } from "./call-room-readiness.js";
import { liveKitApiUrl } from "./livekit-room-provider-adapter.js";

interface TranslationControlRoomClient {
  listParticipants(roomName: string): Promise<Array<{
    identity?: string;
    attributes?: Record<string, string>;
    metadata?: string;
  }>>;
  sendData(
    roomName: string,
    data: Uint8Array,
    kind: DataPacket_Kind,
    options: { topic: string; destinationIdentities: string[] },
  ): Promise<void>;
}

export class TranslationCallControlPublisher {
  private readonly client: TranslationControlRoomClient;

  constructor(
    config: Pick<LiveKitRoomConfig, "livekitUrl" | "apiKey" | "apiSecret">,
    client?: TranslationControlRoomClient,
  ) {
    this.client = client ?? new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async publish(
    roomName: string,
    command: TranslationCallControlCommand,
  ) {
    const expectedIdentity = `translation-${command.callId.slice(0, 12)}-g${
      command.dispatchGeneration
    }`;
    const workers = (await this.client.listParticipants(roomName)).filter(
      (participant) => participant.identity === expectedIdentity &&
        participant.attributes?.["translation.role"] === "worker" &&
        participant.attributes?.["translation.callId"] === command.callId &&
        participant.attributes?.["translation.sessionId"] === command.callId &&
        participant.attributes?.["translation.agentKind"] ===
          "call_translation" &&
        participant.attributes?.["translation.generation"] ===
          String(command.dispatchGeneration) &&
        metadataMatches(participant.metadata, command),
    );
    if (workers.length !== 1 || !workers[0]?.identity) {
      throw new TranslationControlWorkerBindingError(workers.length);
    }
    await this.client.sendData(
      roomName,
      encodeTranslationCallControl(command),
      DataPacket_Kind.RELIABLE,
      {
        topic: translationCallControlTopic,
        destinationIdentities: [workers[0].identity],
      },
    );
    return { workerIdentity: workers[0].identity };
  }
}

function metadataMatches(
  value: string | undefined,
  command: TranslationCallControlCommand,
) {
  if (!value || Buffer.byteLength(value) > 4_096) return false;
  try {
    const metadata = JSON.parse(value) as Record<string, unknown>;
    return metadata.participantRole === "worker" &&
      metadata.callId === command.callId &&
      metadata.sessionId === command.callId &&
      metadata.agentKind === "call_translation" &&
      metadata.dispatchGeneration === command.dispatchGeneration;
  } catch {
    return false;
  }
}

export class TranslationControlWorkerBindingError extends Error {
  constructor(readonly workerCount: number) {
    super("Exactly one current Translation Worker is required");
    this.name = "TranslationControlWorkerBindingError";
  }
}
