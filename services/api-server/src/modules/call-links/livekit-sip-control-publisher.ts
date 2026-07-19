import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import {
  encodeLiveKitSipControl,
  liveKitSipControlTopic,
  type LiveKitSipDtmfCommand,
} from "@translation/contracts";
import type { LiveKitRoomConfig } from "./call-room-readiness.js";
import { liveKitApiUrl } from "./livekit-room-provider-adapter.js";

interface SipControlRoomClient {
  listParticipants(roomName: string): Promise<Array<{
    identity?: string;
    attributes?: Record<string, string>;
  }>>;
  sendData(
    roomName: string,
    data: Uint8Array,
    kind: DataPacket_Kind,
    options: { topic: string; destinationIdentities: string[] },
  ): Promise<void>;
}

export class LiveKitSipControlPublisher {
  private readonly client: SipControlRoomClient;

  constructor(
    config: Pick<LiveKitRoomConfig, "livekitUrl" | "apiKey" | "apiSecret">,
    client?: SipControlRoomClient,
  ) {
    this.client = client ?? new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async publishDtmf(roomName: string, command: LiveKitSipDtmfCommand) {
    const workers = (await this.client.listParticipants(roomName)).filter(
      (participant) => participant.identity &&
        participant.attributes?.["translation.role"] === "worker",
    );
    if (workers.length !== 1 || !workers[0]?.identity) {
      throw new SipControlWorkerBindingError(workers.length);
    }
    await this.client.sendData(
      roomName,
      encodeLiveKitSipControl(command),
      DataPacket_Kind.RELIABLE,
      {
        topic: liveKitSipControlTopic,
        destinationIdentities: [workers[0].identity],
      },
    );
    return { workerIdentity: workers[0].identity };
  }
}

export class SipControlWorkerBindingError extends Error {
  constructor(readonly workerCount: number) {
    super("Exactly one translation worker must be connected for SIP control");
    this.name = "SipControlWorkerBindingError";
  }
}
