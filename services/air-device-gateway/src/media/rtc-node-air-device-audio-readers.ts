import type {
  DeviceSubscribedAudioFrame,
} from "./livekit-device-participant.js";
import type {
  AirGatewayRtcNodeModule,
  RtcRemoteAudioFrame,
  RtcRemotePublication,
} from "./rtc-node-air-device-types.js";

export class RtcNodeAirDeviceAudioReaders {
  private readonly readers = new Map<
    string,
    ReadableStreamDefaultReader<RtcRemoteAudioFrame>
  >();

  constructor(
    private readonly rtc: AirGatewayRtcNodeModule,
    private readonly emit: (frame: DeviceSubscribedAudioFrame) => void,
  ) {}

  start(track: unknown, publication: RtcRemotePublication) {
    if (!publication.sid) return;
    this.stop(publication.sid);
    const stream = new this.rtc.AudioStream(track, {
      sampleRate: 16_000,
      numChannels: 1,
      frameSizeMs: 20,
    });
    const reader = stream.getReader();
    this.readers.set(publication.sid, reader);
    void this.consume(publication.sid, reader);
  }

  stop(trackSid: string) {
    const reader = this.readers.get(trackSid);
    if (!reader) return;
    this.readers.delete(trackSid);
    void reader.cancel().catch(() => undefined);
  }

  stopAll() {
    for (const trackSid of [...this.readers.keys()]) this.stop(trackSid);
  }

  private async consume(
    trackSid: string,
    reader: ReadableStreamDefaultReader<RtcRemoteAudioFrame>,
  ) {
    try {
      while (this.readers.get(trackSid) === reader) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value.sampleRate !== 16_000 || value.channels !== 1 ||
          value.samplesPerChannel !== 320 || value.data.length !== 320) continue;
        this.emit({
          trackSid,
          samples: Int16Array.from(value.data),
          sampleRate: 16_000,
        });
      }
    } catch {
      // Cancelling a reader is an expected subscription lifecycle boundary.
    } finally {
      if (this.readers.get(trackSid) === reader) this.readers.delete(trackSid);
    }
  }
}
