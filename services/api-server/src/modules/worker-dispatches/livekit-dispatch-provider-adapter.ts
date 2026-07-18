import {
  AgentDispatchClient,
  JobRestartPolicy,
  TwirpError,
  type AgentDispatch,
} from "livekit-server-sdk";
import type {
  JobRuntimeDispatch,
  JobRuntimeProvider,
  ProviderAdapterRequest,
  ProviderAdapterResult,
} from "@translation/contracts";
import { liveKitApiUrl } from "../call-links/livekit-room-provider-adapter.js";
import type { LiveKitDispatchConfig } from "./livekit-dispatch-readiness.js";

interface DispatchClient {
  createDispatch(
    roomName: string,
    agentName: string,
    options: {
      metadata?: string;
      restartPolicy?: JobRestartPolicy;
      deployment?: string;
    },
  ): Promise<AgentDispatch>;
  getDispatch(dispatchId: string, roomName: string): Promise<AgentDispatch | undefined>;
  listDispatch(roomName: string): Promise<AgentDispatch[]>;
  deleteDispatch(dispatchId: string, roomName: string): Promise<void>;
}

export class LiveKitDispatchProviderAdapter implements JobRuntimeProvider {
  private readonly client: DispatchClient;

  constructor(
    private readonly config: LiveKitDispatchConfig,
    client?: DispatchClient,
  ) {
    this.client = client ?? new AgentDispatchClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
      { requestTimeout: config.requestTimeoutSeconds },
    );
  }

  async dispatch(
    request: ProviderAdapterRequest<{
      roomName: string;
      agentName: string;
      metadata: string;
      restartPolicy?: "on_failure" | "never";
      deployment?: string;
    }>,
  ): Promise<ProviderAdapterResult<JobRuntimeDispatch>> {
    if (!activeDeadline(request.deadlineAt) ||
      Buffer.byteLength(request.payload.metadata) > this.config.maxMetadataBytes) {
      return failure("invalid_request", false, false);
    }
    try {
      const dispatch = await this.client.createDispatch(
        request.payload.roomName,
        request.payload.agentName,
        {
          metadata: request.payload.metadata,
          restartPolicy: request.payload.restartPolicy === "never"
            ? JobRestartPolicy.JRP_NEVER
            : JobRestartPolicy.JRP_ON_FAILURE,
          ...(request.payload.deployment
            ? { deployment: request.payload.deployment }
            : {}),
        },
      );
      return success(toRuntimeDispatch(dispatch));
    } catch (error) {
      return classifyFailure(error, true);
    }
  }

  async get(input: { roomName: string; dispatchId: string }) {
    try {
      const dispatch = await this.client.getDispatch(input.dispatchId, input.roomName);
      return success(dispatch ? toRuntimeDispatch(dispatch) : null);
    } catch (error) {
      return classifyFailure(error, false);
    }
  }

  async list(roomName: string) {
    try {
      const dispatches = await this.client.listDispatch(roomName);
      return success(dispatches.map(toRuntimeDispatch));
    } catch (error) {
      return classifyFailure(error, false);
    }
  }

  async delete(
    request: ProviderAdapterRequest<{ roomName: string; dispatchId: string }>,
  ) {
    if (!activeDeadline(request.deadlineAt)) {
      return failure("invalid_request", false, false);
    }
    try {
      await this.client.deleteDispatch(
        request.payload.dispatchId,
        request.payload.roomName,
      );
      return success({ dispatchId: request.payload.dispatchId });
    } catch (error) {
      return classifyFailure(error, true);
    }
  }
}

function toRuntimeDispatch(value: AgentDispatch): JobRuntimeDispatch {
  const createdAt = value.state?.createdAt && value.state.createdAt > 0n
    ? new Date(Number(value.state.createdAt / 1_000_000n)).toISOString()
    : undefined;
  return {
    dispatchId: value.id,
    roomName: value.room,
    agentName: value.agentName,
    metadata: value.metadata,
    jobIds: value.state?.jobs.map((job) => job.id) ?? [],
    ...(createdAt ? { createdAt } : {}),
  };
}

function success<T>(result: T): ProviderAdapterResult<T> {
  return {
    ok: true,
    provider: "livekit_dispatch",
    capabilities: ["dispatch", "publish_audio", "subscribe_audio"],
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
  if (error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")) {
    return failure("timeout", true, reconciliationRequired);
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
    provider: "livekit_dispatch",
    errorClass,
    retryable,
    reconciliationRequired,
  };
}

function activeDeadline(value: string) {
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) && Date.now() < deadline;
}
