import {
  RoomServiceClient,
  SipClient,
  TwirpError,
  type CreateSipParticipantOptions,
} from "livekit-server-sdk";
import type {
  ProviderAdapterRequest,
  ProviderAdapterResult,
  SipParticipantProvider,
  TelephonyControlProvider,
} from "@translation/contracts";
import type { LiveKitSipConfig } from "./livekit-sip-readiness.js";
import { liveKitApiUrl } from "./livekit-room-provider-adapter.js";

type SipParticipantPayload = {
  roomName: string;
  phoneNumberReference: string;
  participantIdentity: string;
  initialDtmf?: string;
  participantRole?: "guest" | "operator";
  consultId?: string;
};

interface SipParticipantInfo {
  participantId: string;
  participantIdentity: string;
  roomName: string;
  sipCallId: string;
}

interface LiveKitSipClient {
  createSipParticipant(
    trunkId: string,
    number: string,
    roomName: string,
    options: CreateSipParticipantOptions,
  ): Promise<SipParticipantInfo>;
  transferSipParticipant(
    roomName: string,
    participantIdentity: string,
    transferTo: string,
    options?: { playDialtone?: boolean; ringingTimeout?: number },
  ): Promise<void>;
}

interface LiveKitRoomClient {
  removeParticipant(roomName: string, participantIdentity: string): Promise<void>;
}

export class LiveKitSipProviderAdapter
  implements SipParticipantProvider, TelephonyControlProvider {
  private readonly client: LiveKitSipClient;
  private readonly roomClient: LiveKitRoomClient;

  constructor(
    private readonly config: LiveKitSipConfig,
    client?: LiveKitSipClient,
    roomClient?: LiveKitRoomClient,
  ) {
    this.client = client ?? new SipClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
      { requestTimeout: config.requestTimeoutSeconds },
    );
    this.roomClient = roomClient ?? new RoomServiceClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
    );
  }

  async createParticipant(
    request: ProviderAdapterRequest<SipParticipantPayload>,
  ): Promise<ProviderAdapterResult<{ participantIdentity: string }>> {
    const participantRole = request.payload.participantRole ?? "guest";
    if (!isE164(request.payload.phoneNumberReference) ||
      !validInitialDtmf(request.payload.initialDtmf) ||
      (participantRole === "operator" && !validConsultId(request.payload.consultId)) ||
      (participantRole === "guest" && request.payload.consultId !== undefined) ||
      !activeDeadline(request.deadlineAt)) {
      return failure("invalid_request", false, false);
    }
    try {
      const info = await this.client.createSipParticipant(
        this.config.outboundTrunkId,
        request.payload.phoneNumberReference,
        request.payload.roomName,
        {
          participantIdentity: request.payload.participantIdentity,
          participantName: participantRole === "operator"
            ? "external-operator"
            : "phone-guest",
          participantMetadata: JSON.stringify({
            callId: request.sessionId,
            participantRole,
            joinType: "sip",
            ...(request.payload.consultId
              ? { consultId: request.payload.consultId }
              : {}),
          }),
          participantAttributes: {
            "translation.operationId": request.operationId,
            "translation.sessionId": request.sessionId,
            "translation.role": participantRole,
            ...(request.payload.consultId
              ? { "translation.consultId": request.payload.consultId }
              : {}),
          },
          hidePhoneNumber: true,
          playDialtone: true,
          waitUntilAnswered: false,
          ringingTimeout: this.config.ringingTimeoutSeconds,
          maxCallDuration: this.config.maxCallDurationSeconds,
          timeout: this.config.requestTimeoutSeconds,
          ...(request.payload.initialDtmf
            ? { dtmf: request.payload.initialDtmf }
            : {}),
        },
      );
      return {
        ok: true,
        provider: "livekit_sip",
        externalOperationId: info.sipCallId,
        externalResourceId: info.participantId,
        capabilities: ["sip_outbound", "dtmf", "transfer", "subscribe_audio"],
        result: { participantIdentity: info.participantIdentity },
      };
    } catch (error) {
      return classifyLiveKitSipFailure(error);
    }
  }

  async transferParticipant(
    request: ProviderAdapterRequest<{
      roomName: string;
      participantIdentity: string;
      transferTo: string;
    }>,
  ): Promise<ProviderAdapterResult<{ participantIdentity: string }>> {
    if (!validRoomBinding(request.payload) ||
      !/^tel:\+[1-9]\d{7,14}$/.test(request.payload.transferTo) ||
      !activeDeadline(request.deadlineAt)) {
      return failure("invalid_request", false, false);
    }
    try {
      await this.client.transferSipParticipant(
        request.payload.roomName,
        request.payload.participantIdentity,
        request.payload.transferTo,
        {
          playDialtone: false,
          ringingTimeout: this.config.ringingTimeoutSeconds,
        },
      );
      return controlSuccess(request.payload.participantIdentity, "transfer");
    } catch (error) {
      return classifyLiveKitSipFailure(error);
    }
  }

  async removeParticipant(
    request: ProviderAdapterRequest<{
      roomName: string;
      participantIdentity: string;
    }>,
  ): Promise<ProviderAdapterResult<{ participantIdentity: string }>> {
    if (!validRoomBinding(request.payload) || !activeDeadline(request.deadlineAt)) {
      return failure("invalid_request", false, false);
    }
    try {
      await this.roomClient.removeParticipant(
        request.payload.roomName,
        request.payload.participantIdentity,
      );
      return controlSuccess(request.payload.participantIdentity, "hangup");
    } catch (error) {
      return classifyLiveKitSipFailure(error);
    }
  }
}

function controlSuccess(
  participantIdentity: string,
  capability: "transfer" | "hangup",
): ProviderAdapterResult<{ participantIdentity: string }> {
  return {
    ok: true,
    provider: "livekit_sip",
    externalResourceId: participantIdentity,
    capabilities: [capability],
    result: { participantIdentity },
  };
}

export function classifyLiveKitSipFailure(
  error: unknown,
): ProviderAdapterResult<never> {
  if (error instanceof TwirpError) {
    const sipCode = Number(error.metadata?.sip_status_code);
    if (sipCode >= 400 && sipCode < 500) {
      return failure("unavailable", false, false);
    }
    if (error.status === 400) return failure("invalid_request", false, false);
    if (error.status === 401 || error.status === 403) {
      return failure("unauthorized", false, false);
    }
    if (error.status === 404) return failure("not_found", false, false);
    if (error.status === 409) return failure("conflict", false, true);
    if (error.status === 429) return failure("rate_limited", true, true);
    return failure("unavailable", true, true);
  }
  if (error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")) {
    return failure("timeout", true, true);
  }
  return failure("unknown", true, true);
}

function failure(
  errorClass: Extract<ProviderAdapterResult<never>, { ok: false }>["errorClass"],
  retryable: boolean,
  reconciliationRequired: boolean,
): ProviderAdapterResult<never> {
  return {
    ok: false,
    provider: "livekit_sip",
    errorClass,
    retryable,
    reconciliationRequired,
  };
}

function isE164(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

function validInitialDtmf(value: string | undefined) {
  return value === undefined || /^[0-9*#A-Dw]{1,64}$/.test(value);
}

function validConsultId(value: string | undefined) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function validRoomBinding(value: {
  roomName: string;
  participantIdentity: string;
}) {
  return value.roomName.length > 0 && value.roomName.length <= 128 &&
    value.participantIdentity.length > 0 && value.participantIdentity.length <= 256;
}

function activeDeadline(value: string) {
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) && Date.now() < deadline;
}
