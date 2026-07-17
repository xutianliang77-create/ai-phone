import {
  EncodedFileOutput,
  EncodedFileType,
  DirectFileOutput,
  EgressClient,
  EgressStatus,
  S3Upload,
  TwirpError,
  type EncodedOutputs,
  type EgressInfo,
} from "livekit-server-sdk";
import type {
  ProviderAdapterRequest,
  ProviderAdapterResult,
  RecordingProvider,
  RecordingProviderJob,
} from "@translation/contracts";
import { liveKitApiUrl } from "../call-links/livekit-room-provider-adapter.js";
import type { LiveKitEgressConfig } from "./livekit-egress-readiness.js";

interface EgressApiClient {
  startRoomCompositeEgress(
    roomName: string,
    output: EncodedFileOutput,
    options: { audioOnly: boolean },
  ): Promise<EgressInfo>;
  startParticipantEgress(
    roomName: string,
    identity: string,
    output: EncodedOutputs,
    options?: { screenShare?: boolean },
  ): Promise<EgressInfo>;
  startTrackEgress(
    roomName: string,
    output: DirectFileOutput,
    trackId: string,
  ): Promise<EgressInfo>;
  listEgress(options: {
    roomName?: string;
    egressId?: string;
  }): Promise<EgressInfo[]>;
  stopEgress(egressId: string): Promise<EgressInfo>;
}

export class LiveKitEgressProviderAdapter implements RecordingProvider {
  private readonly client: EgressApiClient;

  constructor(
    private readonly config: LiveKitEgressConfig,
    client?: EgressApiClient,
  ) {
    this.client = client ?? new EgressClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
      { requestTimeout: config.requestTimeoutSeconds },
    );
  }

  async start(
    request: ProviderAdapterRequest<{
      roomName: string;
      recordingType: "room_audio" | "participant" | "track";
      objectKey: string;
      participantIdentity?: string;
      trackId?: string;
    }>,
  ): Promise<ProviderAdapterResult<RecordingProviderJob>> {
    if (!validRecordingTarget(request.payload) ||
      !safeObjectKey(request.payload.objectKey) || !activeDeadline(request.deadlineAt)) {
      return failure("invalid_request", false, false);
    }
    try {
      const info = request.payload.recordingType === "participant"
        ? await this.client.startParticipantEgress(
            request.payload.roomName,
            request.payload.participantIdentity!,
            { file: this.fileOutput(request.payload.objectKey) },
            { screenShare: false },
          )
        : request.payload.recordingType === "track"
        ? await this.client.startTrackEgress(
            request.payload.roomName,
            this.directFileOutput(request.payload.objectKey),
            request.payload.trackId!,
          )
        : await this.client.startRoomCompositeEgress(
            request.payload.roomName,
            this.fileOutput(request.payload.objectKey),
            { audioOnly: true },
          );
      return success(toProviderJob(info));
    } catch (error) {
      return classifyFailure(error, true);
    }
  }

  async get(recordingId: string) {
    try {
      const values = await this.client.listEgress({ egressId: recordingId });
      return success(values[0] ? toProviderJob(values[0]) : null);
    } catch (error) {
      return classifyFailure(error, false);
    }
  }

  async list(roomName: string) {
    try {
      const values = await this.client.listEgress({ roomName });
      return success(values.map(toProviderJob));
    } catch (error) {
      return classifyFailure(error, false);
    }
  }

  async stop(request: ProviderAdapterRequest<{ recordingId: string }>) {
    if (!activeDeadline(request.deadlineAt)) {
      return failure("invalid_request", false, false);
    }
    try {
      return success(toProviderJob(
        await this.client.stopEgress(request.payload.recordingId),
      ));
    } catch (error) {
      return classifyFailure(error, true);
    }
  }

  private fileOutput(objectKey: string) {
    return new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      filepath: objectKey,
      disableManifest: true,
      output: {
        case: "s3",
        value: this.s3Upload(),
      },
    });
  }

  private directFileOutput(objectKey: string) {
    return new DirectFileOutput({
      filepath: objectKey,
      disableManifest: true,
      output: {
        case: "s3",
        value: this.s3Upload(),
      },
    });
  }

  private s3Upload() {
    return new S3Upload({
      accessKey: this.config.accessKey,
      secret: this.config.secretKey,
      region: this.config.region,
      endpoint: this.config.endpoint ?? "",
      bucket: this.config.bucket,
      forcePathStyle: this.config.forcePathStyle,
    });
  }
}

export function toProviderJob(info: EgressInfo): RecordingProviderJob {
  return {
    recordingId: info.egressId,
    roomName: info.roomName,
    status: egressStatus(info.status),
    ...(info.error ? { error: info.error.slice(0, 160) } : {}),
    ...timestamp("startedAt", info.startedAt),
    ...timestamp("endedAt", info.endedAt),
    artifacts: info.fileResults.map((file) => ({
      objectKey: file.filename,
      ...(file.location ? { location: file.location } : {}),
      ...(safeNumber(file.size) !== undefined
        ? { sizeBytes: safeNumber(file.size) }
        : {}),
      ...(safeNumber(file.duration / 1_000_000n) !== undefined
        ? { durationMs: safeNumber(file.duration / 1_000_000n) }
        : {}),
    })),
  };
}

function egressStatus(status: EgressStatus): RecordingProviderJob["status"] {
  if (status === EgressStatus.EGRESS_ACTIVE) return "active";
  if (status === EgressStatus.EGRESS_ENDING) return "ending";
  if (status === EgressStatus.EGRESS_COMPLETE) return "complete";
  if (status === EgressStatus.EGRESS_STARTING) return "starting";
  return "failed";
}

function timestamp<K extends "startedAt" | "endedAt">(key: K, value: bigint) {
  const milliseconds = safeNumber(value / 1_000_000n);
  return milliseconds && milliseconds > 0
    ? { [key]: new Date(milliseconds).toISOString() } as Record<K, string>
    : {};
}

function safeNumber(value: bigint) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function success<T>(result: T): ProviderAdapterResult<T> {
  return {
    ok: true,
    provider: "livekit_egress",
    capabilities: ["recording"],
    result,
  };
}

function classifyFailure(
  error: unknown,
  reconciliationRequired: boolean,
): ProviderAdapterResult<never> {
  if (error instanceof TwirpError) {
    if (error.status === 400) return failure("invalid_request", false, false);
    if (error.status === 401 || error.status === 403) {
      return failure("unauthorized", false, false);
    }
    if (error.status === 404) return failure("not_found", false, false);
    if (error.status === 409) return failure("conflict", false, true);
    if (error.status === 429) return failure("rate_limited", true, true);
  }
  return failure("unavailable", true, reconciliationRequired);
}

function failure(
  errorClass: Extract<ProviderAdapterResult<never>, { ok: false }>["errorClass"],
  retryable: boolean,
  reconciliationRequired: boolean,
): ProviderAdapterResult<never> {
  return {
    ok: false,
    provider: "livekit_egress",
    errorClass,
    retryable,
    reconciliationRequired,
  };
}

function safeObjectKey(value: string) {
  return value.length <= 512 && !value.startsWith("/") && !value.includes("..") &&
    /^[A-Za-z0-9/_.-]+\.ogg$/.test(value);
}

function validRecordingTarget(input: {
  recordingType: "room_audio" | "participant" | "track";
  participantIdentity?: string;
  trackId?: string;
}) {
  if (input.recordingType === "participant") return Boolean(input.participantIdentity);
  if (input.recordingType === "track") return Boolean(input.trackId);
  return !input.participantIdentity && !input.trackId;
}

function activeDeadline(value: string) {
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) && Date.now() < deadline;
}
