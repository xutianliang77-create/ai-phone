export type ExternalMediaInputType = "rtmp" | "whip" | "url" | "srt";
export type ExternalMediaSourceStatus =
  | "requested"
  | "ready"
  | "buffering"
  | "publishing"
  | "completed"
  | "failed"
  | "deleting";

export interface ExternalMediaSourceDto {
  id: string;
  sessionId: string;
  roomName: string;
  provider: "livekit_ingress";
  inputType: ExternalMediaInputType;
  participantIdentity: string;
  status: ExternalMediaSourceStatus;
  sourcePolicyVersion: string;
  idempotencyKey: string;
  requestHash: string;
  sourceUrlHash?: string;
  sourceFinalUrlHash?: string;
  sourceResolutionHash?: string;
  sourceValidatedAt?: string;
  version: number;
  providerOperationId?: string;
  externalIngressId?: string;
  externalBridgeId?: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  lastErrorClass?: string;
}

export interface ExternalMediaProviderJob {
  ingressId: string;
  roomName: string;
  participantIdentity: string;
  status: "inactive" | "buffering" | "publishing" | "complete" | "failed";
  connectionUrl?: string;
  streamKey?: string;
  bridgeId?: string;
  replayed?: boolean;
  error?: string;
  startedAt?: string;
  endedAt?: string;
}
