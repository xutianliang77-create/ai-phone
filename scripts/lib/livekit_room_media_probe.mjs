export function waitForCallRoomCaption(room, rtc, segmentId, options) {
  return withTimeout(new Promise((resolve) => {
    room.on(rtc.RoomEvent.DataReceived, (data, participant) => {
      try {
        const event = JSON.parse(Buffer.from(data).toString("utf8"));
        if (event.type !== "transcript.final" || event.segmentId !== segmentId) return;
        resolve({
          ok: true,
          details: {
            bytes: data.byteLength,
            segmentId: event.segmentId,
            from: participant?.identity ?? null,
          },
        });
      } catch {
        // Ignore unrelated data packets while waiting for the server caption.
      }
    });
  }), timeoutMs(options), "Timed out waiting for server call-room caption");
}

export function waitForWorkerAudio(room, rtc, options) {
  return withTimeout(new Promise((resolve, reject) => {
    room.on(rtc.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      void readFirstAudioFrame(track, participant, rtc).then(resolve, reject);
    });
  }), timeoutMs(options), "Timed out waiting for worker audio subscription");
}

export function waitForTranslationTtsAudio(room, rtc, options) {
  return withTimeout(new Promise((resolve, reject) => {
    room.on(rtc.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const name = trackName(track, publication);
      if (!/^translation-tts-guest-[1-9][0-9]*$/.test(name)) return;
      void readFirstAudioFrame(track, participant, rtc).then((result) => {
        resolve({
          ok: result.ok,
          details: { ...result.details, trackName: name },
        });
      }, reject);
    });
  }), timeoutMs(options), "Timed out waiting for worker TTS audio subscription");
}

export async function publishGuestAudioTrack(room, rtc) {
  return publishPcmAudioTrack(room, rtc, "media-readiness-guest-audio");
}

export async function publishTranslationTtsTrack(room, rtc) {
  return publishPcmAudioTrack(room, rtc, "translation-tts-guest-16000");
}

export function rtcMediaReady(rtc) {
  const required = [
    "Room",
    "RoomEvent",
    "AudioStream",
    "AudioFrame",
    "AudioSource",
    "LocalAudioTrack",
    "TrackPublishOptions",
    "TrackSource",
  ];
  const missing = required.filter((key) => !rtc?.[key]);
  return { ok: missing.length === 0, details: { missing } };
}

export async function closeTracks(tracks) {
  for (const track of tracks) {
    await track?.close?.().catch(() => {});
  }
}

export async function disconnectRooms(rooms) {
  await Promise.all(rooms.map((room) => room.disconnect?.().catch(() => {})));
}

async function readFirstAudioFrame(track, participant, rtc) {
  const stream = new rtc.AudioStream(track, {
    sampleRate: 16000,
    numChannels: 1,
    frameSizeMs: 100,
  });
  const reader = stream.getReader();
  try {
    const result = await reader.read();
    if (result.done || !result.value) {
      return { ok: false, details: { reason: "audio stream ended" } };
    }
    return {
      ok: true,
      details: {
        sampleRate: result.value.sampleRate,
        samples: result.value.data?.length ?? 0,
        fromRole: participantRole(participant),
      },
    };
  } finally {
    reader.releaseLock();
  }
}

async function publishPcmAudioTrack(room, rtc, trackName) {
  const source = new rtc.AudioSource(16000, 1);
  const track = rtc.LocalAudioTrack.createAudioTrack(trackName, source);
  const options = new rtc.TrackPublishOptions();
  options.source = rtc.TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(track, options);
  for (let index = 0; index < 8; index += 1) {
    const samples = toneFrame(16000, 100, index);
    await source.captureFrame(new rtc.AudioFrame(samples, 16000, 1, samples.length));
    await sleep(20);
  }
  await source.waitForPlayout?.();
  return track;
}

function trackName(track, publication) {
  if (typeof publication?.name === "string" && publication.name) return publication.name;
  if (typeof publication?.trackName === "string" && publication.trackName) {
    return publication.trackName;
  }
  return typeof track?.name === "string" ? track.name : "";
}

function toneFrame(sampleRate, frameSizeMs, phaseOffset) {
  const sampleCount = Math.floor(sampleRate * frameSizeMs / 1000);
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index + phaseOffset * sampleCount;
    samples[index] = Math.round(Math.sin(2 * Math.PI * 440 * t / sampleRate) * 8000);
  }
  return samples;
}

function participantRole(participant) {
  if (typeof participant?.metadata !== "string") return null;
  try {
    return JSON.parse(participant.metadata).participantRole ?? null;
  } catch {
    return null;
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function timeoutMs(options) {
  return Number(options.timeoutMs ?? 15000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
