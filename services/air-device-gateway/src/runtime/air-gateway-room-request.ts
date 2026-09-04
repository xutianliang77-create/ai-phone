import type { AirDeviceMediaPolicy } from "@translation/contracts";
import type { AirDeviceSessionBinding } from
  "../device/device-session-router.js";

export interface AirGatewayRoomAccess {
  wsUrl: string;
  token: string;
  expiresAt: string;
  mediaPolicy: AirDeviceMediaPolicy;
}

export interface AirGatewayRoomRequest extends AirDeviceSessionBinding {
  participantIdentity: string;
  roomName: string;
  roomAccess: AirGatewayRoomAccess;
}
