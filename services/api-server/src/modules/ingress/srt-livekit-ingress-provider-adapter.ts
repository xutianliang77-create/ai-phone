import type {
  ExternalMediaProvider,
  ExternalMediaProviderJob,
  ProviderAdapterFailure,
  ProviderAdapterResult,
  ProviderAdapterSuccess,
} from "@translation/contracts";
import { LiveKitIngressProviderAdapter } from
  "./livekit-ingress-provider-adapter.js";
import {
  SrtIngressBridgeClient,
  type SrtIngressBridgeJob,
} from "./srt-ingress-bridge-client.js";

export class SrtLiveKitIngressProviderAdapter implements ExternalMediaProvider {
  private readonly livekit: Pick<
    LiveKitIngressProviderAdapter,
    "create" | "get" | "list" | "delete"
  >;
  private readonly bridge: Pick<
    SrtIngressBridgeClient,
    "create" | "get" | "getByIdempotency" | "delete"
  >;

  constructor(
    private readonly config: {
      livekitUrl: string;
      apiKey: string;
      apiSecret: string;
      requestTimeoutSeconds: number;
      srtBridgeBaseUrl: string;
      srtBridgeApiKey: string;
    },
    dependencies?: {
      livekit?: Pick<LiveKitIngressProviderAdapter, "create" | "get" | "list" | "delete">;
      bridge?: Pick<
        SrtIngressBridgeClient,
        "create" | "get" | "getByIdempotency" | "delete"
      >;
    },
  ) {
    this.livekit = dependencies?.livekit ?? new LiveKitIngressProviderAdapter(config);
    this.bridge = dependencies?.bridge ?? new SrtIngressBridgeClient({
      baseUrl: config.srtBridgeBaseUrl,
      apiKey: config.srtBridgeApiKey,
      timeoutMs: config.requestTimeoutSeconds * 1000,
    });
  }

  async create(request: Parameters<ExternalMediaProvider["create"]>[0]) {
    if (request.payload.inputType !== "srt") return invalid();
    const ingress = await this.livekit.create({
      ...request,
      payload: { ...request.payload, inputType: "rtmp", enableTranscoding: true },
    });
    if (!ingress.ok) return ingress;
    const targetUrl = rtmpTarget(
      ingress.result.connectionUrl,
      ingress.result.streamKey,
    );
    if (!targetUrl) {
      if (ingress.result.replayed) {
        const replay = await this.bridge.getByIdempotency(request.idempotencyKey);
        if (replay.ok && activeBridge(replay.job)) {
          return combine(ingress, replay.job);
        }
        if (!replay.ok && replay.errorClass !== "not_found") {
          return failure(
            replay.errorClass as ProviderAdapterFailure["errorClass"],
            replay.retryable,
            replay.unknown,
            ingress.result.ingressId,
          );
        }
      }
      const cleanup = await this.cleanupLiveKit(request, ingress.result.ingressId);
      return failure("unavailable", false, !cleanup, ingress.result.ingressId);
    }
    const bridge = await this.bridge.create({
      idempotencyKey: request.idempotencyKey,
      targetUrl,
      maxDurationSeconds: maxDurationSeconds(),
    });
    if (!bridge.ok) {
      const cleanup = await this.cleanupLiveKit(request, ingress.result.ingressId);
      return failure(
        bridge.errorClass as ProviderAdapterFailure["errorClass"],
        bridge.retryable,
        bridge.unknown || !cleanup,
        ingress.result.ingressId,
      );
    }
    if (!activeBridge(bridge.job)) {
      const cleanup = await this.cleanupLiveKit(request, ingress.result.ingressId);
      return failure("unavailable", false, !cleanup, ingress.result.ingressId);
    }
    return combine(ingress, bridge.job);
  }

  get(ingressId: string) {
    return this.livekit.get(ingressId);
  }

  getBridge(bridgeId: string) {
    return this.bridge.get(bridgeId);
  }

  list(roomName: string) {
    return this.livekit.list(roomName);
  }

  async delete(request: Parameters<ExternalMediaProvider["delete"]>[0]) {
    if (!request.payload.bridgeId) return invalid();
    const bridge = await this.bridge.delete(request.payload.bridgeId);
    if (!bridge.ok && bridge.errorClass !== "not_found") {
      return failure(
        bridge.errorClass as ProviderAdapterFailure["errorClass"],
        bridge.retryable,
        bridge.unknown,
      );
    }
    return this.livekit.delete(request);
  }

  private async cleanupLiveKit(
    request: Parameters<ExternalMediaProvider["create"]>[0],
    ingressId: string,
  ) {
    const result = await this.livekit.delete({
      ...request,
      idempotencyKey: `${request.idempotencyKey}:cleanup`,
      payload: { ingressId },
    });
    return result.ok || (!result.ok && result.errorClass === "not_found");
  }
}

function combine(
  ingress: ProviderAdapterSuccess<ExternalMediaProviderJob>,
  bridge: SrtIngressBridgeJob,
): ProviderAdapterSuccess<ExternalMediaProviderJob> {
  return {
    ...ingress,
    result: {
      ...ingress.result,
      bridgeId: bridge.bridgeId,
      connectionUrl: bridge.connectionUrl,
      streamKey: undefined,
      replayed: Boolean(ingress.result.replayed || bridge.replayed),
    },
  };
}

function activeBridge(job: SrtIngressBridgeJob) {
  return job.status === "starting" || job.status === "running";
}

function rtmpTarget(url?: string, streamKey?: string) {
  if (!url || !streamKey || !/^[A-Za-z0-9_-]{8,256}$/.test(streamKey)) return null;
  try {
    const parsed = new URL(url);
    if (!["rtmp:", "rtmps:"].includes(parsed.protocol) || parsed.username ||
      parsed.password || parsed.hash || parsed.search) return null;
    return `${url.replace(/\/$/, "")}/${streamKey}`;
  } catch {
    return null;
  }
}

function maxDurationSeconds() {
  const value = Number(process.env.SRT_INGRESS_MAX_DURATION_SECONDS ?? 7200);
  return Number.isInteger(value) && value >= 60 && value <= 14_400 ? value : 7200;
}

function invalid(): ProviderAdapterFailure {
  return failure("invalid_request", false, false);
}

function failure(
  errorClass: ProviderAdapterFailure["errorClass"],
  retryable: boolean,
  reconciliationRequired: boolean,
  externalOperationId?: string,
): ProviderAdapterFailure {
  return {
    ok: false,
    provider: "livekit_ingress",
    errorClass,
    retryable,
    reconciliationRequired,
    ...(externalOperationId ? { externalOperationId } : {}),
  };
}
