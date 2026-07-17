import {
  IngressClient,
  IngressInput,
  TwirpError,
  type IngressInfo,
} from "livekit-server-sdk";
import { IngressState_Status } from "@livekit/protocol";
import type {
  ExternalMediaProvider,
  ExternalMediaProviderJob,
  ProviderAdapterResult,
} from "@translation/contracts";
import { liveKitApiUrl } from "../call-links/livekit-room-provider-adapter.js";

interface IngressApiClient {
  createIngress(
    input: IngressInput,
    options: {
      roomName: string;
      participantIdentity: string;
      participantName: string;
      participantMetadata: string;
      enableTranscoding: boolean;
      url?: string;
    },
  ): Promise<IngressInfo>;
  listIngress(options: { roomName?: string; ingressId?: string }): Promise<IngressInfo[]>;
  deleteIngress(ingressId: string): Promise<IngressInfo>;
}

export class LiveKitIngressProviderAdapter implements ExternalMediaProvider {
  private readonly client: IngressApiClient;

  constructor(
    config: { livekitUrl: string; apiKey: string; apiSecret: string; requestTimeoutSeconds: number },
    client?: IngressApiClient,
  ) {
    this.client = client ?? new IngressClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
      { requestTimeout: config.requestTimeoutSeconds },
    );
  }

  async create(request: Parameters<ExternalMediaProvider["create"]>[0]) {
    if (!activeDeadline(request.deadlineAt) ||
      request.payload.inputType === "srt" ||
      (request.payload.inputType === "url" && !request.payload.sourceUrl)) {
      return failure("invalid_request", false, false);
    }
    try {
      const existing = (await this.client.listIngress({
        roomName: request.payload.roomName,
      })).filter((value) =>
        value.participantIdentity === request.payload.participantIdentity
      );
      if (existing.length > 1) return failure("conflict", false, true);
      if (existing[0]) {
        return success({ ...toProviderJob(existing[0]), replayed: true });
      }
      const info = await this.client.createIngress(
        ingressInput(request.payload.inputType),
        {
          roomName: request.payload.roomName,
          participantIdentity: request.payload.participantIdentity,
          participantName: "External media",
          participantMetadata: JSON.stringify({
            participantRole: "external_source",
            sourcePolicyVersion: request.payload.sourcePolicyVersion,
          }),
          enableTranscoding: request.payload.enableTranscoding,
          ...(request.payload.sourceUrl ? { url: request.payload.sourceUrl } : {}),
        },
      );
      return success(toProviderJob(info));
    } catch (error) {
      return classify(error, true);
    }
  }

  async get(ingressId: string) {
    try {
      const values = await this.client.listIngress({ ingressId });
      return success(values[0] ? toProviderJob(values[0]) : null);
    } catch (error) {
      return classify(error, false);
    }
  }

  async list(roomName: string) {
    try {
      return success((await this.client.listIngress({ roomName })).map(toProviderJob));
    } catch (error) {
      return classify(error, false);
    }
  }

  async delete(request: Parameters<ExternalMediaProvider["delete"]>[0]) {
    if (!activeDeadline(request.deadlineAt)) {
      return failure("invalid_request", false, false);
    }
    try {
      return success(toProviderJob(
        await this.client.deleteIngress(request.payload.ingressId),
      ));
    } catch (error) {
      return classify(error, true);
    }
  }
}

export function toIngressProviderJob(info: IngressInfo): ExternalMediaProviderJob {
  const state = info.state;
  return {
    ingressId: info.ingressId,
    roomName: info.roomName,
    participantIdentity: info.participantIdentity,
    status: ingressStatus(state?.status),
    ...(info.url ? { connectionUrl: info.url } : {}),
    ...(info.streamKey ? { streamKey: info.streamKey } : {}),
    ...(state?.error ? { error: state.error.slice(0, 160) } : {}),
    ...timestamp("startedAt", state?.startedAt),
    ...timestamp("endedAt", state?.endedAt),
  };
}

const toProviderJob = toIngressProviderJob;

function ingressInput(value: "rtmp" | "whip" | "url" | "srt") {
  if (value === "whip") return IngressInput.WHIP_INPUT;
  if (value === "url") return IngressInput.URL_INPUT;
  return IngressInput.RTMP_INPUT;
}

function ingressStatus(value: IngressState_Status | undefined): ExternalMediaProviderJob["status"] {
  if (value === IngressState_Status.ENDPOINT_BUFFERING) return "buffering";
  if (value === IngressState_Status.ENDPOINT_PUBLISHING) return "publishing";
  if (value === IngressState_Status.ENDPOINT_COMPLETE) return "complete";
  if (value === IngressState_Status.ENDPOINT_ERROR) return "failed";
  return "inactive";
}

function timestamp<K extends "startedAt" | "endedAt">(key: K, value?: bigint) {
  if (!value || value <= 0n) return {};
  const milliseconds = Number(value / 1_000_000n);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return {};
  return { [key]: new Date(milliseconds).toISOString() } as Record<K, string>;
}

function success<T>(result: T): ProviderAdapterResult<T> {
  return { ok: true, provider: "livekit_ingress", capabilities: ["ingress"], result };
}

function classify(error: unknown, reconciliationRequired: boolean): ProviderAdapterResult<never> {
  if (error instanceof TwirpError) {
    if (error.status === 400) return failure("invalid_request", false, false);
    if ([401, 403].includes(error.status)) return failure("unauthorized", false, false);
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
  return { ok: false, provider: "livekit_ingress", errorClass, retryable, reconciliationRequired };
}

function activeDeadline(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() < time;
}
