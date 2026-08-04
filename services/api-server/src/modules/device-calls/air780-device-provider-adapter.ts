import type {
  PhoneCallControlPayload,
  PhoneCallResult,
  PhoneCallStatus,
  PlacePhoneCallPayload,
  ProviderAdapterRequest,
  ProviderAdapterResult,
  SendPhoneDtmfPayload,
  TelephonyProvider,
} from "@translation/contracts";

interface DeviceLeaseVerifier {
  assertLease(input: {
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    nowMs: number;
  }): void;
}

interface AirDeviceGatewayClient {
  dial(input: DeviceCommandBinding & {
    phoneNumberReference: string;
    participantIdentity: string;
    roomName: string;
  }): Promise<{ providerCallId: string; state: PhoneCallStatus["state"] }>;
  hangup(input: DeviceCommandBinding & {
    providerCallId: string;
  }): Promise<{ state: PhoneCallStatus["state"] }>;
  sendDtmf(input: DeviceCommandBinding & {
    providerCallId: string;
    digits: string;
  }): Promise<{ state: PhoneCallStatus["state"] }>;
  reconcile(input: DeviceCommandBinding & {
    providerCallId: string;
  }): Promise<{ state: PhoneCallStatus["state"]; observedAt?: string }>;
}

interface DeviceCallRecorder {
  recordDial(input: {
    providerCallId: string;
    providerOperationId: string;
    communicationSessionId: string;
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    roomName: string;
    participantIdentity: string;
    callGeneration: number;
  }): Promise<unknown>;
}

interface DeviceCommandBinding {
  commandId: string;
  idempotencyKey: string;
  communicationSessionId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
}

export class Air780DeviceProviderAdapter implements TelephonyProvider {
  constructor(private readonly dependencies: {
    leaseVerifier: DeviceLeaseVerifier;
    callRecorder: DeviceCallRecorder;
    gateway: AirDeviceGatewayClient;
  }) {}

  async placePhoneCall(
    request: ProviderAdapterRequest<PlacePhoneCallPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallResult>> {
    const payload = request.payload;
    if (!validRequestBinding(request, payload.communicationSessionId) ||
      payload.transport !== "air780_volte" ||
      !Number.isInteger(payload.callGeneration) || payload.callGeneration < 0 ||
      payload.callGeneration > 0xffffffff ||
      !/^\+[1-9]\d{7,14}$/.test(payload.phoneNumberReference) ||
      !payload.deviceLease ||
      payload.roomName !== `call_${payload.communicationSessionId}` ||
      payload.participantIdentity !==
        `${payload.communicationSessionId}:guest:air:${payload.deviceLease.deviceId}`) {
      return failure("invalid_request", false, false);
    }
    const lease = payload.deviceLease;
    let providerCallId: string | undefined;
    try {
      this.assertLease(lease);
      const result = await this.dependencies.gateway.dial({
        ...commandBinding(request, payload.communicationSessionId, lease),
        phoneNumberReference: payload.phoneNumberReference,
        participantIdentity: payload.participantIdentity,
        roomName: payload.roomName,
      });
      providerCallId = result.providerCallId;
      await this.dependencies.callRecorder.recordDial({
        providerCallId: result.providerCallId,
        providerOperationId: request.operationId,
        communicationSessionId: payload.communicationSessionId,
        deviceId: lease.deviceId,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        roomName: payload.roomName,
        participantIdentity: payload.participantIdentity,
        callGeneration: payload.callGeneration,
      });
      return {
        ok: true,
        provider: "air780_volte",
        externalOperationId: request.operationId,
        externalResourceId: result.providerCallId,
        capabilities: [
          "phone_outbound",
          "dtmf",
          "hangup",
          "publish_audio",
          "subscribe_audio",
        ],
        result: {
          communicationSessionId: payload.communicationSessionId,
          providerCallId: result.providerCallId,
          participantIdentity: payload.participantIdentity,
          state: result.state,
          deviceId: lease.deviceId,
        },
      };
    } catch (error) {
      return classify(error, providerCallId);
    }
  }

  sendPhoneDtmf(request: ProviderAdapterRequest<SendPhoneDtmfPayload>) {
    if (!/^[0-9*#A-D]{1,64}$/.test(request.payload.digits)) {
      return Promise.resolve(failure("invalid_request", false, false));
    }
    return this.control(request, (binding) => this.dependencies.gateway.sendDtmf({
      ...binding,
      providerCallId: request.payload.providerCallId,
      digits: request.payload.digits,
    }));
  }

  hangupPhoneCall(request: ProviderAdapterRequest<PhoneCallControlPayload>) {
    return this.control(request, (binding) => this.dependencies.gateway.hangup({
      ...binding,
      providerCallId: request.payload.providerCallId,
    }));
  }

  reconcilePhoneCall(request: ProviderAdapterRequest<PhoneCallControlPayload>) {
    return this.control(request, (binding) => this.dependencies.gateway.reconcile({
      ...binding,
      providerCallId: request.payload.providerCallId,
    }));
  }

  private async control(
    request: ProviderAdapterRequest<PhoneCallControlPayload>,
    execute: (binding: DeviceCommandBinding) => Promise<{
      state: PhoneCallStatus["state"];
      observedAt?: string;
    }>,
  ): Promise<ProviderAdapterResult<PhoneCallStatus>> {
    const payload = request.payload;
    if (!validRequestBinding(request, payload.communicationSessionId) ||
      !payload.providerCallId || !payload.deviceLease) {
      return failure("invalid_request", false, false);
    }
    try {
      this.assertLease(payload.deviceLease);
      const result = await execute(commandBinding(
        request,
        payload.communicationSessionId,
        payload.deviceLease,
      ));
      return {
        ok: true,
        provider: "air780_volte",
        externalOperationId: request.operationId,
        externalResourceId: payload.providerCallId,
        capabilities: ["dtmf", "hangup"],
        result: {
          communicationSessionId: payload.communicationSessionId,
          providerCallId: payload.providerCallId,
          state: result.state,
          deviceId: payload.deviceLease.deviceId,
          ...(result.observedAt ? { observedAt: result.observedAt } : {}),
        },
      };
    } catch (error) {
      return classify(error);
    }
  }

  private assertLease(lease: NonNullable<PlacePhoneCallPayload["deviceLease"]>) {
    this.dependencies.leaseVerifier.assertLease({ ...lease, nowMs: Date.now() });
  }
}

function validRequestBinding(
  request: ProviderAdapterRequest<unknown>,
  communicationSessionId: string,
) {
  return request.sessionId === communicationSessionId &&
    Number.isInteger(request.expectedVersion) && request.expectedVersion >= 0 &&
    request.operationId.length > 0 && request.idempotencyKey.length > 0 &&
    Date.parse(request.deadlineAt) > Date.now();
}

function commandBinding(
  request: ProviderAdapterRequest<unknown>,
  communicationSessionId: string,
  lease: NonNullable<PlacePhoneCallPayload["deviceLease"]>,
): DeviceCommandBinding {
  return {
    commandId: request.operationId,
    idempotencyKey: request.idempotencyKey,
    communicationSessionId,
    ...lease,
  };
}

function classify(
  error: unknown,
  externalResourceId?: string,
): ProviderAdapterResult<never> {
  if (error instanceof Error && error.name === "DeviceLeaseConflict") {
    return failure("conflict", false, false, externalResourceId);
  }
  if (error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")) {
    return failure("timeout", true, true, externalResourceId);
  }
  return failure("unavailable", true, true, externalResourceId);
}

function failure(
  errorClass: Extract<ProviderAdapterResult<never>, { ok: false }>["errorClass"],
  retryable: boolean,
  reconciliationRequired: boolean,
  externalResourceId?: string,
): ProviderAdapterResult<never> {
  return {
    ok: false,
    provider: "air780_volte",
    errorClass,
    retryable,
    reconciliationRequired,
    ...(externalResourceId ? { externalResourceId } : {}),
  };
}
