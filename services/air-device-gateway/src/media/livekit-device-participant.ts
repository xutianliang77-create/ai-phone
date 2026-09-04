import type {
  AirDeviceMediaPolicy,
  AirDeviceUplinkSource,
} from "@translation/contracts";

export interface DeviceRemoteTrack {
  sid: string;
  name: string;
  publisherIdentity: string;
  /** Binding returned by the trusted server track-admission check. */
  admission?: {
    uplinkSource: AirDeviceUplinkSource;
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

export interface DeviceSubscribedAudioFrame {
  trackSid: string;
  samples: Int16Array;
  sampleRate: 16_000;
}

export interface AirDeviceRoomClient {
  connect(
    wsUrl: string,
    token: string,
    options: {
      autoSubscribe: false;
      communicationSessionId: string;
      mediaPolicy: AirDeviceMediaPolicy;
    },
  ): Promise<void>;
  disconnect?(): Promise<void>;
  publishPcmTrack(
    name: string,
    samples: Int16Array,
    sampleRate: 8_000 | 16_000,
  ): Promise<void>;
  setSubscribed(trackSid: string, subscribed: boolean): Promise<void>;
  onConnectionState?(
    listener: (state: "reconnecting" | "joined" | "disconnected") => void,
  ): () => void;
  onRemoteTrackPublished?(
    listener: (track: Omit<DeviceRemoteTrack, "admission">) => void,
  ): () => void;
  onRemoteTrackUnpublished?(listener: (trackSid: string) => void): () => void;
  onSubscribedAudioFrame?(
    listener: (frame: DeviceSubscribedAudioFrame) => void,
  ): () => void;
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
    mediaPolicy: AirDeviceMediaPolicy;
    token: string;
    wsUrl: string;
  }) {
    this.identity = airDeviceParticipantProfile(options).identity;
  }

  async connect() {
    await this.options.room.connect(
      this.options.wsUrl,
      this.options.token,
      {
        autoSubscribe: false,
        communicationSessionId: this.options.communicationSessionId,
        mediaPolicy: this.options.mediaPolicy,
      },
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
    const source = this.admittedUplinkSource(track);
    await this.options.room.setSubscribed(track.sid, source !== null);
    return source;
  }

  admittedUplinkSource(track: DeviceRemoteTrack): AirDeviceUplinkSource | null {
    const targetToken = Buffer.from(this.identity).toString("base64url");
    const isTranslationWorker = isTranslationWorkerIdentity(
      track.publisherIdentity,
      this.options.communicationSessionId,
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
    const isTakeoverHost = isTakeoverHostIdentity(
      track.publisherIdentity,
      this.options.communicationSessionId,
    );
    if (!hasExactAdmission) return null;
    if (admission.uplinkSource === "translated_tts" &&
      isTranslationWorker && isExactTarget) {
      return "translated_tts";
    }
    if (admission.uplinkSource === "takeover_microphone" &&
      isTakeoverHost && track.name === "microphone") {
      return "takeover_microphone";
    }
    return null;
  }
}

function isTranslationWorkerIdentity(
  publisherIdentity: string,
  communicationSessionId: string,
) {
  const workerPrefix = `${communicationSessionId}:worker:`;
  const canonicalWorker = publisherIdentity.startsWith(workerPrefix) &&
    /^[A-Za-z0-9_-]{1,128}$/.test(publisherIdentity.slice(workerPrefix.length));
  const agentPrefix = `translation-${communicationSessionId.slice(0, 12)}-g`;
  const liveKitAgent = publisherIdentity.startsWith(agentPrefix) &&
    /^[1-9][0-9]*$/.test(publisherIdentity.slice(agentPrefix.length));
  return canonicalWorker || liveKitAgent;
}

function isTakeoverHostIdentity(
  publisherIdentity: string,
  communicationSessionId: string,
) {
  const prefix = `${communicationSessionId}:host:`;
  return publisherIdentity.startsWith(prefix) &&
    /^[A-Za-z0-9_-]{1,128}$/.test(publisherIdentity.slice(prefix.length));
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
