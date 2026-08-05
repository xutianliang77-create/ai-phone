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

export type AirDeviceCarrierState = "dialing" | "ringing" | "connected" |
  "disconnected" | "busy" | "failed" | "unknown";

export type AirDeviceCarrierCause = "none" | "local_hangup" |
  "remote_hangup" | "busy" | "no_answer" | "rejected" |
  "network_error" | "device_error" | "unknown";

export type AirDeviceLiveKitParticipantState = "absent" | "joining" |
  "joined" | "reconnecting" | "disconnected";

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
  carrierState: AirDeviceCarrierState;
  liveKitParticipantState: AirDeviceLiveKitParticipantState;
  callGeneration: number;
  version: number;
  connectedAt?: string;
  endedAt?: string;
}

export interface AirDeviceCarrierEventRequest {
  eventId: string;
  communicationSessionId: string;
  providerCallId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  callGeneration: number;
  eventSequence: number;
  carrierState: AirDeviceCarrierState;
  carrierCause: AirDeviceCarrierCause;
  occurredAt: string;
}

export interface AirDeviceLiveKitParticipantEventRequest {
  eventId: string;
  communicationSessionId: string;
  providerCallId: string;
  deviceId: string;
  leaseId: string;
  fencingToken: number;
  callGeneration: number;
  eventSequence: number;
  liveKitParticipantState: AirDeviceLiveKitParticipantState;
  occurredAt: string;
}

export interface AirDeviceHeartbeatRequest {
  eventId: string;
  deviceId: string;
  bootId: string;
  firmwareVersion: string;
  protocolVersion: string;
  supportedSampleRates: Array<8_000 | 16_000>;
  heartbeatSequence: number;
  uptimeMs: string;
  deviceState: "ready" | "in_call" | "quarantined" | "fault";
  observedAt: string;
  activeBinding?: {
    communicationSessionId: string;
    providerCallId: string;
    deviceId: string;
    leaseId: string;
    fencingToken: number;
    callGeneration: number;
  };
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

export interface AirDeviceTrackAdmissionRequest extends
AirDeviceTrackAdmissionDto {
  roomName: string;
  fencingToken: number;
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
  callGeneration: number;
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
