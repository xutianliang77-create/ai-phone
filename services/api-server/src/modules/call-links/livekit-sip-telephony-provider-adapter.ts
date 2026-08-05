import type {
  PhoneCallControlPayload,
  PhoneCallResult,
  PhoneCallStatus,
  PlacePhoneCallPayload,
  ProviderAdapterRequest,
  ProviderAdapterResult,
  SendPhoneDtmfPayload,
  SipParticipantProvider,
  TelephonyProvider,
} from "@translation/contracts";
import { LiveKitSipProviderAdapter } from "./livekit-sip-provider-adapter.js";
import type { LiveKitSipConfig } from "./livekit-sip-readiness.js";

export class LiveKitSipTelephonyProviderAdapter implements TelephonyProvider {
  private readonly sip: SipParticipantProvider;

  constructor(config: LiveKitSipConfig, sip?: SipParticipantProvider) {
    this.sip = sip ?? new LiveKitSipProviderAdapter(config);
  }

  async placePhoneCall(
    request: ProviderAdapterRequest<PlacePhoneCallPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallResult>> {
    const payload = request.payload;
    if (payload.transport !== "livekit_sip" || payload.deviceLease ||
      payload.communicationSessionId !== request.sessionId) {
      return failure("invalid_request", false, false);
    }
    const result = await this.sip.createParticipant({
      operationId: request.operationId,
      sessionId: request.sessionId,
      expectedVersion: request.expectedVersion,
      idempotencyKey: request.idempotencyKey,
      deadlineAt: request.deadlineAt,
      payload: {
        roomName: payload.roomName,
        phoneNumberReference: payload.phoneNumberReference,
        participantIdentity: payload.participantIdentity,
        ...(payload.initialDtmf ? { initialDtmf: payload.initialDtmf } : {}),
      },
    });
    if (!result.ok) return result;
    const providerCallId = result.externalOperationId ??
      result.externalResourceId ?? request.operationId;
    return {
      ok: true,
      provider: "livekit_sip",
      externalOperationId: result.externalOperationId,
      externalResourceId: result.externalResourceId,
      capabilities: ["phone_outbound", ...result.capabilities],
      result: {
        communicationSessionId: request.sessionId,
        providerCallId,
        participantIdentity: result.result.participantIdentity,
        state: "dialing",
      },
    };
  }

  sendPhoneDtmf(
    _request: ProviderAdapterRequest<SendPhoneDtmfPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallStatus>> {
    return Promise.resolve(failure("unavailable", false, false));
  }

  hangupPhoneCall(
    _request: ProviderAdapterRequest<PhoneCallControlPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallStatus>> {
    return Promise.resolve(failure("unavailable", false, false));
  }

  reconcilePhoneCall(
    _request: ProviderAdapterRequest<PhoneCallControlPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallStatus>> {
    return Promise.resolve(failure("unavailable", false, true));
  }
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
