import type { ExternalMediaProviderJob } from "./ingress.js";

export type CommunicationProvider =
  | "livekit"
  | "livekit_sip"
  | "livekit_dispatch"
  | "livekit_egress"
  | "livekit_ingress"
  | "pstn_http"
  | "pstn_fonoster"
  | "pstn_mock";

export type ProviderCapability =
  | "room"
  | "publish_audio"
  | "subscribe_audio"
  | "sip_inbound"
  | "sip_outbound"
  | "dtmf"
  | "hangup"
  | "transfer"
  | "clear_playback"
  | "dispatch"
  | "recording"
  | "ingress";

export interface ProviderOperationContext {
  operationId: string;
  sessionId: string;
  expectedVersion: number;
  idempotencyKey: string;
  deadlineAt: string;
}

export interface ProviderAdapterRequest<TPayload = unknown>
  extends ProviderOperationContext {
  payload: TPayload;
}

export interface ProviderAdapterSuccess<TResult = unknown> {
  ok: true;
  provider: CommunicationProvider;
  externalOperationId?: string;
  externalResourceId?: string;
  capabilities: ProviderCapability[];
  result: TResult;
}

export interface ProviderAdapterFailure {
  ok: false;
  provider: CommunicationProvider;
  errorClass:
    | "invalid_request"
    | "unauthorized"
    | "not_found"
    | "conflict"
    | "capacity"
    | "rate_limited"
    | "timeout"
    | "unavailable"
    | "unknown";
  retryable: boolean;
  reconciliationRequired: boolean;
  externalOperationId?: string;
}

export type ProviderAdapterResult<TResult = unknown> =
  | ProviderAdapterSuccess<TResult>
  | ProviderAdapterFailure;

export interface CommunicationProviderAdapter<TPayload, TResult> {
  execute(
    request: ProviderAdapterRequest<TPayload>,
  ): Promise<ProviderAdapterResult<TResult>>;
}

export interface MediaRoomProvider {
  ensureRoom(
    request: ProviderAdapterRequest<{ roomName: string }>,
  ): Promise<ProviderAdapterResult<{ roomName: string }>>;
}

export interface TelephonyProvider {
  createParticipant(
    request: ProviderAdapterRequest<{
      roomName: string;
      phoneNumberReference: string;
      participantIdentity: string;
      initialDtmf?: string;
      participantRole?: "guest" | "operator";
      consultId?: string;
    }>,
  ): Promise<ProviderAdapterResult<{ participantIdentity: string }>>;
}

export interface TelephonyControlProvider {
  transferParticipant(
    request: ProviderAdapterRequest<{
      roomName: string;
      participantIdentity: string;
      transferTo: string;
    }>,
  ): Promise<ProviderAdapterResult<{ participantIdentity: string }>>;
  removeParticipant(
    request: ProviderAdapterRequest<{
      roomName: string;
      participantIdentity: string;
    }>,
  ): Promise<ProviderAdapterResult<{ participantIdentity: string }>>;
}

export interface TelephonyInboundProvider {
  createDispatch(
    request: ProviderAdapterRequest<{
      roomName: string;
      trunkId: string;
      pin: string;
      attributes: Record<string, string>;
    }>,
  ): Promise<ProviderAdapterResult<{ dispatchRuleId: string }>>;
  deleteDispatch(
    request: ProviderAdapterRequest<{ dispatchRuleId: string }>,
  ): Promise<ProviderAdapterResult<{ dispatchRuleId: string }>>;
}

export interface JobRuntimeProvider {
  dispatch(
    request: ProviderAdapterRequest<{
      roomName: string;
      agentName: string;
      metadata: string;
      restartPolicy?: "on_failure" | "never";
      deployment?: string;
    }>,
  ): Promise<ProviderAdapterResult<JobRuntimeDispatch>>;
  get(input: {
    roomName: string;
    dispatchId: string;
  }): Promise<ProviderAdapterResult<JobRuntimeDispatch | null>>;
  list(roomName: string): Promise<ProviderAdapterResult<JobRuntimeDispatch[]>>;
  delete(
    request: ProviderAdapterRequest<{
      roomName: string;
      dispatchId: string;
    }>,
  ): Promise<ProviderAdapterResult<{ dispatchId: string }>>;
}

export interface JobRuntimeDispatch {
  dispatchId: string;
  roomName: string;
  agentName: string;
  metadata: string;
  jobIds: string[];
  createdAt?: string;
}

export interface RecordingProvider {
  start(
    request: ProviderAdapterRequest<{
      roomName: string;
      recordingType: "room_audio" | "participant" | "track";
      objectKey: string;
      participantIdentity?: string;
      trackId?: string;
    }>,
  ): Promise<ProviderAdapterResult<RecordingProviderJob>>;
  get(recordingId: string): Promise<ProviderAdapterResult<RecordingProviderJob | null>>;
  list(roomName: string): Promise<ProviderAdapterResult<RecordingProviderJob[]>>;
  stop(
    request: ProviderAdapterRequest<{ recordingId: string }>,
  ): Promise<ProviderAdapterResult<RecordingProviderJob>>;
}

export interface RecordingProviderJob {
  recordingId: string;
  roomName: string;
  status: "starting" | "active" | "ending" | "complete" | "failed";
  error?: string;
  startedAt?: string;
  endedAt?: string;
  artifacts: Array<{
    objectKey: string;
    location?: string;
    sizeBytes?: number;
    durationMs?: number;
  }>;
}

export interface ExternalMediaProvider {
  create(
    request: ProviderAdapterRequest<{
      roomName: string;
      inputType: "rtmp" | "whip" | "url" | "srt";
      participantIdentity: string;
      sourcePolicyVersion: string;
      sourceUrl?: string;
      enableTranscoding: boolean;
    }>,
  ): Promise<ProviderAdapterResult<ExternalMediaProviderJob>>;
  get(ingressId: string): Promise<ProviderAdapterResult<ExternalMediaProviderJob | null>>;
  list(roomName: string): Promise<ProviderAdapterResult<ExternalMediaProviderJob[]>>;
  delete(
    request: ProviderAdapterRequest<{ ingressId: string; bridgeId?: string }>,
  ): Promise<ProviderAdapterResult<ExternalMediaProviderJob>>;
}
