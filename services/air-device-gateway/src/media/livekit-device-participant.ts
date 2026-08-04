export interface DeviceRemoteTrack {
  sid: string;
  name: string;
  publisherIdentity: string;
  /** Binding returned by the trusted server track-admission check. */
  admission?: {
    trackSid: string;
    trackName: string;
    publisherIdentity: string;
    communicationSessionId: string;
    targetParticipantIdentity: string;
    deviceId: string;
    leaseId: string;
    callGeneration: number;
  };
}

export interface AirDeviceRoomClient {
  connect(
    wsUrl: string,
    token: string,
    options: { autoSubscribe: false },
  ): Promise<void>;
  publishPcmTrack(
    name: string,
    samples: Int16Array,
    sampleRate: 8_000 | 16_000,
  ): Promise<void>;
  setSubscribed(trackSid: string, subscribed: boolean): Promise<void>;
}

export function airDeviceParticipantProfile(input: {
  communicationSessionId: string;
  deviceId: string;
  leaseId: string;
  callGeneration: number;
}) {
  assertIdentifier(input.communicationSessionId, "communicationSessionId", 160);
  assertIdentifier(input.deviceId, "deviceId");
  assertIdentifier(input.leaseId, "leaseId");
  assertUint32(input.callGeneration, "callGeneration");
  const identity = `${input.communicationSessionId}:guest:air:${input.deviceId}`;
  return {
    identity,
    attributes: {
      "ai.phone.call_id": input.communicationSessionId,
      "ai.phone.communication_session_id": input.communicationSessionId,
      "ai.phone.participant_role": "guest",
      "ai.phone.transport": "air780",
      "ai.phone.device_id": input.deviceId,
      "ai.phone.lease_id": input.leaseId,
      "ai.phone.call_generation": String(input.callGeneration),
    },
  };
}

export class AirDeviceLiveKitParticipant {
  private readonly identity: string;

  constructor(private readonly options: {
    room: AirDeviceRoomClient;
    communicationSessionId: string;
    deviceId: string;
    leaseId: string;
    callGeneration: number;
    token: string;
    wsUrl: string;
  }) {
    this.identity = airDeviceParticipantProfile(options).identity;
  }

  async connect() {
    await this.options.room.connect(
      this.options.wsUrl,
      this.options.token,
      { autoSubscribe: false },
    );
  }

  async publishDownlink(samples: Int16Array, sampleRate: 8_000 | 16_000) {
    await this.options.room.publishPcmTrack(
      `air780-downlink-${this.options.deviceId}`,
      samples,
      sampleRate,
    );
  }

  async handleRemoteTrack(track: DeviceRemoteTrack) {
    const targetToken = Buffer.from(this.identity).toString("base64url");
    const isTranslationWorker = track.publisherIdentity.startsWith(
      `${this.options.communicationSessionId}:worker:`,
    ) && /^[A-Za-z0-9_-]{1,128}$/.test(
      track.publisherIdentity.slice(
        `${this.options.communicationSessionId}:worker:`.length,
      ),
    );
    const isExactTarget = new RegExp(
      `^translation-tts-guest-[1-9][0-9]*\\.${targetToken}$`,
    ).test(track.name);
    const admission = track.admission;
    const hasExactAdmission = admission?.communicationSessionId ===
        this.options.communicationSessionId &&
      admission.trackSid === track.sid &&
      admission.trackName === track.name &&
      admission.publisherIdentity === track.publisherIdentity &&
      admission.targetParticipantIdentity === this.identity &&
      admission.deviceId === this.options.deviceId &&
      admission.leaseId === this.options.leaseId &&
      admission.callGeneration === this.options.callGeneration;
    await this.options.room.setSubscribed(
      track.sid,
      isTranslationWorker && isExactTarget && hasExactAdmission,
    );
  }
}

function assertIdentifier(value: string, name: string, maximum = 128) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > maximum) {
    throw new Error(`Invalid ${name}`);
  }
}

function assertUint32(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Invalid ${name}`);
  }
}
