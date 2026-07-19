import type { RtcNodeModule } from "./livekit-call-audio-source-types.js";

export function shouldForwardAudioTrack(track: unknown, publication: unknown) {
  return !/^translation-tts-(host|guest)-[1-9][0-9]*(?:\.[A-Za-z0-9_-]+)?$/
    .test(audioTrackName(track, publication));
}

export function isAudioPublication(
  publication: { kind?: unknown },
  rtc: RtcNodeModule,
) {
  const audioKind = rtc.TrackKind?.KIND_AUDIO;
  return audioKind === undefined || publication.kind === undefined ||
    publication.kind === audioKind;
}

export function isRemoteAudioTrack(
  track: unknown,
  RemoteAudioTrack?: new (...args: unknown[]) => object,
) {
  return !RemoteAudioTrack || track instanceof RemoteAudioTrack;
}

export function normalizeSampleRate(sampleRate: number): 16000 | 24000 {
  return sampleRate === 16000 ? 16000 : 24000;
}

export function int16Base64(data: Int16Array) {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function audioTrackName(track: unknown, publication: unknown) {
  const value = publication as { name?: unknown; trackName?: unknown };
  if (typeof value.name === "string" && value.name) return value.name;
  if (typeof value.trackName === "string" && value.trackName) return value.trackName;
  const trackValue = (track ?? {}) as { name?: unknown };
  return typeof trackValue.name === "string" ? trackValue.name : "";
}
