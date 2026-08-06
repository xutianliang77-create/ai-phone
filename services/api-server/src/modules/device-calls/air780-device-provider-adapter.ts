import { createHash } from "node:crypto";
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

export interface AirDeviceGatewayClient {
  dial(input: DeviceCommandBinding & {
    providerCallId: string;
    phoneNumberReference: string;
    participantIdentity: string;
    roomName: string;
    roomAccess: AirDeviceRoomAccess;
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
  recordDial(input: DeviceCallRecordInput): Promise<unknown>;
  recordDialRejected(input: DeviceCallRecordInput): Promise<unknown>;
}

interface DeviceCallRecordInput {
  providerCallId: string;
  providerOperationId: string;
  communicationSessionId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  roomName: string;
  participantIdentity: string;
  callGeneration: number;
}

export interface AirDeviceRoomAccess {
  wsUrl: string;
  token: string;
  expiresAt: string;
}

interface DeviceRoomAccessIssuer {
  issue(input: {
    communicationSessionId: string;
    roomName: string;
    deviceId: string;
    leaseId: string;
    callGeneration: number;
  }): Promise<AirDeviceRoomAccess>;
}

export interface DeviceCommandBinding {
  providerOperationId: string;
  commandId: string;
  idempotencyKey: string;
  communicationSessionId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  callGeneration: number;
}

export class Air780DeviceProviderAdapter implements TelephonyProvider {
  constructor(private readonly dependencies: {
    leaseVerifier: DeviceLeaseVerifier;
    callRecorder: DeviceCallRecorder;
    roomAccessIssuer: DeviceRoomAccessIssuer;
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
    const providerCallId = airDeviceProviderCallId(request.operationId);
    let roomAccess: AirDeviceRoomAccess;
    try {
      this.assertLease(lease);
      roomAccess = await this.dependencies.roomAccessIssuer.issue({
        communicationSessionId: payload.communicationSessionId,
        roomName: payload.roomName,
        deviceId: lease.deviceId,
        leaseId: lease.leaseId,
        callGeneration: payload.callGeneration,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "DeviceLeaseConflict") {
        return classify(error);
      }
      return failure("unavailable", true, false);
    }
    const callRecord = {
      providerCallId,
      providerOperationId: request.operationId,
      communicationSessionId: payload.communicationSessionId,
      deviceId: lease.deviceId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      roomName: payload.roomName,
      participantIdentity: payload.participantIdentity,
      callGeneration: payload.callGeneration,
    };
    try {
      await this.dependencies.callRecorder.recordDial(callRecord);
    } catch {
      return failure("unavailable", true, false, providerCallId);
    }
    try {
      const result = await this.dependencies.gateway.dial({
        ...commandBinding(
          request,
          payload.communicationSessionId,
          lease,
          payload.callGeneration,
        ),
        providerCallId,
        phoneNumberReference: payload.phoneNumberReference,
        participantIdentity: payload.participantIdentity,
        roomName: payload.roomName,
        roomAccess,
      });
      if (result.providerCallId !== providerCallId) {
        throw new Error("Air Gateway provider call binding conflict");
      }
      return {
        ok: true,
        provider: "air780_volte",
        externalOperationId: request.operationId,
        externalResourceId: providerCallId,
        capabilities: [
          "phone_outbound",
          "dtmf",
          "hangup",
          "publish_audio",
          "subscribe_audio",
        ],
        result: {
          communicationSessionId: payload.communicationSessionId,
          providerCallId,
          participantIdentity: payload.participantIdentity,
          state: result.state,
          deviceId: lease.deviceId,
        },
      };
    } catch (error) {
      if (error instanceof Error && [
        "DeviceCommandRejected",
        "DeviceCommandNotDispatched",
      ].includes(error.name)) {
        try {
          await this.dependencies.callRecorder.recordDialRejected(callRecord);
        } catch {
          return failure("unavailable", true, true, providerCallId);
        }
        if (error.name === "DeviceCommandNotDispatched") {
          return failure("unavailable", true, false, providerCallId);
        }
      }
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
      !payload.providerCallId || !payload.deviceLease ||
      !Number.isInteger(payload.callGeneration) || payload.callGeneration < 0 ||
      payload.callGeneration > 0xffffffff) {
      return failure("invalid_request", false, false);
    }
    try {
      this.assertLease(payload.deviceLease);
      const result = await execute(commandBinding(
        request,
        payload.communicationSessionId,
        payload.deviceLease,
        payload.callGeneration,
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
  callGeneration: number,
): DeviceCommandBinding {
  return {
    providerOperationId: request.operationId,
    commandId: request.operationId,
    idempotencyKey: request.idempotencyKey,
    communicationSessionId,
    callGeneration,
    // Keep database lease metadata out of the VUART command envelope.
    // The Gateway schema accepts only the fenced device binding fields.
    deviceId: lease.deviceId,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
  };
}

export function airDeviceProviderCallId(operationId: string) {
  return `air_${createHash("sha256").update(operationId).digest("hex").slice(0, 32)}`;
}

function classify(
  error: unknown,
  externalResourceId?: string,
): ProviderAdapterResult<never> {
  if (error instanceof Error && error.name === "DeviceLeaseConflict") {
    return failure("conflict", false, false, externalResourceId);
  }
  if (error instanceof Error && error.name === "DeviceCommandRejected") {
    return failure("conflict", false, false, externalResourceId);
  }
  if (error instanceof Error && error.name === "DeviceCommandNotDispatched") {
    return failure("unavailable", true, false, externalResourceId);
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
