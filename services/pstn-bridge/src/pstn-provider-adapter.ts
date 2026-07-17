import type {
  CommunicationProvider,
  CommunicationProviderAdapter,
  ProviderAdapterRequest,
  ProviderAdapterResult,
} from "@translation/contracts";
import type {
  AgentCallBridgeRequest,
  AgentCallBridgeResult,
  PlaybackInterruptRequest,
  PstnBridgeProviderName,
  PstnProvider,
  TtsAudioSinkRequest,
  TtsAudioSinkResult,
} from "./types.js";

export class PstnProviderAdapter
  implements PstnProvider,
    CommunicationProviderAdapter<AgentCallBridgeRequest, AgentCallBridgeResult> {
  readonly providerName: CommunicationProvider;
  readonly playbackCapabilities;

  constructor(
    providerName: PstnBridgeProviderName,
    private readonly delegate: PstnProvider,
  ) {
    this.providerName = providerId(providerName);
    this.playbackCapabilities = delegate.playbackCapabilities;
  }

  async execute(request: ProviderAdapterRequest<AgentCallBridgeRequest>):
    Promise<ProviderAdapterResult<AgentCallBridgeResult>> {
    try {
      const result = await this.delegate.placeCall(request.payload);
      return {
        ok: true,
        provider: this.providerName,
        externalOperationId: result.providerCallId,
        externalResourceId: result.mediaStreamId,
        capabilities: this.providerName === "pstn_mock"
          ? []
          : ["sip_outbound", "publish_audio"],
        result,
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.providerName,
        errorClass: isTimeout(error) ? "timeout" : "unavailable",
        retryable: true,
        reconciliationRequired: true,
      };
    }
  }

  async placeCall(request: AgentCallBridgeRequest) {
    const result = await this.execute({
      operationId: `pstn:place:${request.callId}`,
      sessionId: request.callId,
      expectedVersion: 1,
      idempotencyKey: request.idempotencyKey,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      payload: request,
    });
    if (result.ok) return result.result;
    throw new Error(`${result.provider} place call failed: ${result.errorClass}`);
  }

  playTranslatedAudio(request: TtsAudioSinkRequest): Promise<TtsAudioSinkResult> {
    return this.delegate.playTranslatedAudio(request);
  }

  interruptPlayback(request: PlaybackInterruptRequest) {
    return this.delegate.interruptPlayback
      ? this.delegate.interruptPlayback(request)
      : Promise.resolve({ cleared: false });
  }
}

function providerId(value: PstnBridgeProviderName): CommunicationProvider {
  if (value === "fonoster") return "pstn_fonoster";
  if (value === "http") return "pstn_http";
  return "pstn_mock";
}

function isTimeout(error: unknown) {
  return error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("timeout"));
}
