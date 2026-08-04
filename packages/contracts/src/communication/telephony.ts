import type {
  ProviderAdapterRequest,
  ProviderAdapterResult,
} from "./provider-adapters.js";

export type PhoneCallTransport = "air780_volte" | "livekit_sip";

export type PhoneCallState =
  | "dialing"
  | "ringing"
  | "connected"
  | "media_ready"
  | "active"
  | "ending"
  | "completed"
  | "failed"
  | "unknown";

export interface DeviceLeaseBinding {
  deviceId: string;
  leaseId: string;
  fencingToken: number;
}

export type AirDeviceStatus =
  | "ready"
  | "reserved"
  | "quarantined"
  | "offline"
  | "fault";

export interface AirDeviceRegistrationDto {
  deviceId: string;
  firmwareVersion: string;
  protocolVersion: string;
  supportedSampleRates: Array<8_000 | 16_000>;
  status: AirDeviceStatus;
  lastHeartbeatAt: string;
  fencingToken: number;
  version: number;
}

export interface AirDeviceLeaseDto {
  deviceId: string;
  leaseId: string;
  communicationSessionId: string;
  ownerId: string;
  fencingToken: number;
  status: "active" | "released" | "expired";
  expiresAt: string;
  version: number;
}

export interface AirDeviceCallDto {
  providerCallId: string;
  communicationSessionId: string;
  providerOperationId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  carrierState: "dialing" | "ringing" | "connected" | "disconnected" |
    "busy" | "failed" | "unknown";
  liveKitParticipantState: "absent" | "joining" | "joined" |
    "reconnecting" | "disconnected";
  callGeneration: number;
  version: number;
}

export interface AirDeviceTrackAdmissionDto {
  trackSid: string;
  trackName: string;
  publisherIdentity: string;
  communicationSessionId: string;
  targetParticipantIdentity: string;
  deviceId: string;
  leaseId: string;
  callGeneration: number;
}

export interface PlacePhoneCallPayload {
  communicationSessionId: string;
  transport: PhoneCallTransport;
  callGeneration: number;
  roomName: string;
  phoneNumberReference: string;
  participantIdentity: string;
  deviceLease?: DeviceLeaseBinding;
  initialDtmf?: string;
}

export interface PhoneCallControlPayload {
  communicationSessionId: string;
  providerCallId: string;
  deviceLease?: DeviceLeaseBinding;
}

export interface SendPhoneDtmfPayload extends PhoneCallControlPayload {
  digits: string;
}

export interface PhoneCallResult {
  communicationSessionId: string;
  providerCallId: string;
  participantIdentity: string;
  state: PhoneCallState;
  deviceId?: string;
}

export interface PhoneCallStatus {
  communicationSessionId: string;
  providerCallId: string;
  state: PhoneCallState;
  deviceId?: string;
  observedAt?: string;
}

/** Business telephony contract. A concrete provider may be Air780 or SIP. */
export interface TelephonyProvider {
  placePhoneCall(
    request: ProviderAdapterRequest<PlacePhoneCallPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallResult>>;
  sendPhoneDtmf(
    request: ProviderAdapterRequest<SendPhoneDtmfPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallStatus>>;
  hangupPhoneCall(
    request: ProviderAdapterRequest<PhoneCallControlPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallStatus>>;
  reconcilePhoneCall(
    request: ProviderAdapterRequest<PhoneCallControlPayload>,
  ): Promise<ProviderAdapterResult<PhoneCallStatus>>;
}
