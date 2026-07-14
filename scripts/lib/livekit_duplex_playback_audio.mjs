export const DUPLEX_SAMPLE_RATE = 16000;

export function playbackInput(input) {
  return {
    callId: input.callId,
    segmentId: `${input.targetSpeakerRole}-generation-${input.generation}`,
    playbackId: `${input.targetSpeakerRole}-generation-${input.generation}`,
    generation: input.generation,
    sourceLegId: `${input.callId}:${input.sourceSpeakerRole}`,
    targetLegId: input.targetLegId,
    sourceSpeakerRole: input.sourceSpeakerRole,
    targetSpeakerRole: input.targetSpeakerRole,
    language: input.targetSpeakerRole === "host" ? "zh" : "en",
    speech: {
      provider: "acceptance-tone",
      model: `${input.frequency}hz`,
      audioDurationMs: input.durationMs,
      audio: {
        format: "pcm16",
        sampleRate: DUPLEX_SAMPLE_RATE,
        data: tonePcmBase64(input.frequency, input.durationMs),
      },
    },
    signal: input.controller.signal,
  };
}

export function waitForAudioCollector(room, rtc, expectedTrackName, options) {
  return withTimeout(new Promise((resolve) => {
    room.on(rtc.RoomEvent.TrackSubscribed, (track, publication) => {
      const name = publication?.name ?? publication?.trackName ?? track?.name ?? "";
      if (name !== expectedTrackName) return;
      resolve(collectAudioFrames(track, rtc));
    });
  }), timeoutMs(options), `Timed out waiting for ${expectedTrackName}`);
}

export function estimateFrequency(samples, sampleRate) {
  if (!samples?.length) return 0;
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index - 1] < 0 && samples[index] >= 0) ||
      (samples[index - 1] >= 0 && samples[index] < 0)) crossings += 1;
  }
  return crossings * sampleRate / (2 * samples.length);
}

export function countFrames(frames, minimum, maximum, time = {}) {
  return frames.filter((frame) =>
    inRange(frame.frequency, minimum, maximum) &&
    (time.before === undefined || frame.receivedAt < time.before) &&
    (time.after === undefined || frame.receivedAt >= time.after)
  ).length;
}

export function firstFrequencyAt(frames, minimum, maximum) {
  return frames.find((frame) => inRange(frame.frequency, minimum, maximum))?.receivedAt ?? 0;
}

export function inRange(value, minimum, maximum) {
  return value >= minimum && value <= maximum;
}

function tonePcmBase64(frequency, durationMs) {
  const sampleCount = Math.floor(DUPLEX_SAMPLE_RATE * durationMs / 1000);
  const buffer = Buffer.allocUnsafe(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(
      Math.sin(2 * Math.PI * frequency * index / DUPLEX_SAMPLE_RATE) * 9000,
    );
    buffer.writeInt16LE(sample, index * 2);
  }
  return buffer.toString("base64");
}

function collectAudioFrames(track, rtc) {
  const stream = new rtc.AudioStream(track, {
    sampleRate: DUPLEX_SAMPLE_RATE,
    numChannels: 1,
    frameSizeMs: 20,
  });
  const reader = stream.getReader();
  const frames = [];
  let stopped = false;
  const reading = (async () => {
    while (!stopped) {
      const result = await reader.read();
      if (result.done || !result.value) break;
      frames.push({
        receivedAt: Date.now(),
        frequency: estimateFrequency(result.value.data, result.value.sampleRate),
      });
    }
  })().catch(() => undefined);
  return {
    frames,
    async stop() {
      stopped = true;
      await reader.cancel().catch(() => undefined);
      await reading;
      reader.releaseLock();
    },
  };
}

function withTimeout(promise, timeout, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeout)),
  ]);
}

function timeoutMs(options) {
  return Number(options.timeoutMs ?? 20000);
}
