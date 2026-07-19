import { SipClient } from "livekit-server-sdk";
import type {
  ProviderAdapterRequest,
  ProviderAdapterResult,
  TelephonyInboundProvider,
} from "@translation/contracts";
import type { LiveKitSipConfig } from "./livekit-sip-readiness.js";
import { liveKitApiUrl } from "./livekit-room-provider-adapter.js";
import { classifyLiveKitSipFailure } from "./livekit-sip-provider-adapter.js";

interface InboundSipClient {
  createSipDispatchRule(
    rule: { type: "direct"; roomName: string; pin: string },
    options: {
      name: string;
      trunkIds: string[];
      hidePhoneNumber: boolean;
      attributes: Record<string, string>;
    },
  ): Promise<{ sipDispatchRuleId: string }>;
  deleteSipDispatchRule(ruleId: string): Promise<unknown>;
}

export class LiveKitSipInboundProviderAdapter
  implements TelephonyInboundProvider {
  private readonly client: InboundSipClient;

  constructor(config: LiveKitSipConfig, client?: InboundSipClient) {
    this.client = client ?? new SipClient(
      liveKitApiUrl(config.livekitUrl),
      config.apiKey,
      config.apiSecret,
      { requestTimeout: config.requestTimeoutSeconds },
    );
  }

  async createDispatch(
    request: ProviderAdapterRequest<{
      roomName: string;
      trunkId: string;
      pin: string;
      attributes: Record<string, string>;
    }>,
  ): Promise<ProviderAdapterResult<{ dispatchRuleId: string }>> {
    if (!activeDeadline(request.deadlineAt) ||
      !/^ST_[A-Za-z0-9_-]{6,}$/.test(request.payload.trunkId) ||
      !/^\d{4,12}$/.test(request.payload.pin) ||
      request.payload.roomName.length === 0) return invalid();
    try {
      const info = await this.client.createSipDispatchRule(
        {
          type: "direct",
          roomName: request.payload.roomName,
          pin: request.payload.pin,
        },
        {
          name: `inbound-${request.operationId.slice(-16)}`,
          trunkIds: [request.payload.trunkId],
          hidePhoneNumber: true,
          attributes: request.payload.attributes,
        },
      );
      return {
        ok: true,
        provider: "livekit_sip",
        externalResourceId: info.sipDispatchRuleId,
        capabilities: ["sip_inbound", "subscribe_audio"],
        result: { dispatchRuleId: info.sipDispatchRuleId },
      };
    } catch (error) {
      return classifyLiveKitSipFailure(error);
    }
  }

  async deleteDispatch(
    request: ProviderAdapterRequest<{ dispatchRuleId: string }>,
  ): Promise<ProviderAdapterResult<{ dispatchRuleId: string }>> {
    if (!activeDeadline(request.deadlineAt) ||
      !/^SDR_[A-Za-z0-9_-]{6,}$/.test(request.payload.dispatchRuleId)) return invalid();
    try {
      await this.client.deleteSipDispatchRule(request.payload.dispatchRuleId);
      return {
        ok: true,
        provider: "livekit_sip",
        externalResourceId: request.payload.dispatchRuleId,
        capabilities: ["sip_inbound"],
        result: { dispatchRuleId: request.payload.dispatchRuleId },
      };
    } catch (error) {
      const failed = classifyLiveKitSipFailure(error);
      return !failed.ok && failed.errorClass === "not_found"
        ? {
          ok: true,
          provider: "livekit_sip",
          externalResourceId: request.payload.dispatchRuleId,
          capabilities: ["sip_inbound"],
          result: { dispatchRuleId: request.payload.dispatchRuleId },
        }
        : failed;
    }
  }
}

function activeDeadline(value: string) {
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) && Date.now() < deadline;
}

function invalid(): ProviderAdapterResult<never> {
  return {
    ok: false,
    provider: "livekit_sip",
    errorClass: "invalid_request",
    retryable: false,
    reconciliationRequired: false,
  };
}
