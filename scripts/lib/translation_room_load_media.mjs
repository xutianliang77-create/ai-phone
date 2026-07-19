import { readPcm16MonoWav } from "./realtime_speaker_turn_readiness.mjs";

const CAPTION_TOPIC = "translation.captions";
const OBSERVED_TYPES = new Set([
  "transcript.final",
  "translation.final",
  "tts.ready",
  "playback.started",
  "playback.ended",
  "playback.failed",
]);

export function createCallRoomEventCollector(room, rtc, options = {}) {
  const events = [];
  const nowMs = options.nowMs ?? Date.now;
  const handler = (data, participant, _kind, topic) => {
    if (participant || (topic && topic !== CAPTION_TOPIC)) return;
    try {
      const event = JSON.parse(Buffer.from(data).toString("utf8"));
      if (OBSERVED_TYPES.has(event.type)) events.push({ event, observedAtMs: nowMs() });
    } catch {
      // Ignore unrelated or malformed room data while collecting load evidence.
    }
  };
  room.on(rtc.RoomEvent.DataReceived, handler);
  return {
    get length() {
      return events.length;
    },
    events,
    waitForCycle(input) {
      return waitForFinalCycle(events, input, options);
    },
    waitForEvent(input) {
      return waitForObservedEvent(events, input, options);
    },
    close() {
      room.off?.(rtc.RoomEvent.DataReceived, handler);
    },
  };
}

export function createTtsAudioObserver(room, rtc, targetRole, options = {}) {
  const readers = new Set();
  const tasks = new Set();
  let frames = 0;
  let firstFrameAtMs = null;
  let stopped = false;
  const nowMs = options.nowMs ?? Date.now;
  const handler = (track, publication) => {
    const name = trackName(track, publication);
    if (!ttsTrackPattern(targetRole).test(name)) return;
    const stream = new rtc.AudioStream(track, {
      sampleRate: 16000,
      numChannels: 1,
      frameSizeMs: 20,
    });
    const reader = stream.getReader();
    readers.add(reader);
    const task = readFrames(reader, () => {
      frames += 1;
      firstFrameAtMs ??= nowMs();
    }, () => stopped).finally(() => {
      readers.delete(reader);
      tasks.delete(task);
    });
    tasks.add(task);
  };
  room.on(rtc.RoomEvent.TrackSubscribed, handler);
  return {
    get frameCount() {
      return frames;
    },
    get firstFrameAtMs() {
      return firstFrameAtMs;
    },
    waitForFrameAfter(count, timeoutMs) {
      return waitUntil(
        () => frames > count,
        timeoutMs,
        "Timed out waiting for translated TTS audio",
        options,
      );
    },
    async close() {
      stopped = true;
      room.off?.(rtc.RoomEvent.TrackSubscribed, handler);
      for (const reader of readers) await reader.cancel?.().catch(() => undefined);
      await Promise.allSettled([...tasks]);
    },
  };
}

export async function publishWavAudioTrack(room, rtc, options) {
  const fixture = (options.readWav ?? readPcm16MonoWav)(options.path);
  const source = new rtc.AudioSource(fixture.sampleRate, 1);
  const track = rtc.LocalAudioTrack.createAudioTrack(options.trackName, source);
  const publishOptions = new rtc.TrackPublishOptions();
  publishOptions.source = rtc.TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(track, publishOptions);
  return {
    sampleRate: fixture.sampleRate,
    audioDurationMs: Math.ceil(fixture.pcm.length / 2 / fixture.sampleRate * 1000),
    async play(input = {}) {
      const frameMs = input.frameMs ?? 20;
      const frameSamples = Math.floor(fixture.sampleRate * frameMs / 1000);
      const samples = pcm16Samples(fixture.pcm);
      const startedAtMs = (options.nowMs ?? Date.now)();
      for (let offset = 0; offset < samples.length; offset += frameSamples) {
        throwIfAborted(input.signal);
        const chunk = samples.slice(offset, Math.min(samples.length, offset + frameSamples));
        await source.captureFrame(new rtc.AudioFrame(
          chunk,
          fixture.sampleRate,
          1,
          chunk.length,
        ));
        await abortableDelay(frameMs, input.signal, options.sleep);
      }
      const silenceFrames = Math.ceil((input.silenceMs ?? 1200) / frameMs);
      for (let index = 0; index < silenceFrames; index += 1) {
        throwIfAborted(input.signal);
        const silence = new Int16Array(frameSamples);
        await source.captureFrame(new rtc.AudioFrame(
          silence,
          fixture.sampleRate,
          1,
          silence.length,
        ));
        await abortableDelay(frameMs, input.signal, options.sleep);
      }
      return { startedAtMs, endedAtMs: (options.nowMs ?? Date.now)() };
    },
    async close() {
      source.clearQueue?.();
      await track.close?.();
    },
  };
}

export async function waitForWorkerParticipant(room, timeoutMs, options = {}) {
  await waitUntil(
    () => [...(room.remoteParticipants?.values() ?? [])].some(isWorkerParticipant),
    timeoutMs,
    "Timed out waiting for the Translation Worker participant",
    options,
  );
}

async function waitForFinalCycle(events, input, options) {
  let matched;
  await waitUntil(() => {
    const candidates = events.slice(input.afterIndex);
    const transcripts = candidates.filter((item) =>
      item.event.type === "transcript.final" &&
      item.event.speakerRole === input.speakerRole
    );
    for (let index = transcripts.length - 1; index >= 0; index -= 1) {
      const transcript = transcripts[index];
      const sameSegment = (item, type) => item.event.type === type &&
        item.event.segmentId === transcript.event.segmentId &&
        item.event.pipelineGeneration === transcript.event.pipelineGeneration;
      const translation = candidates.find((item) =>
        sameSegment(item, "translation.final")
      );
      const tts = candidates.find((item) => sameSegment(item, "tts.ready"));
      if (!translation || !tts) continue;
      matched = { transcript, translation, tts };
      return true;
    }
    return false;
  }, input.timeoutMs, "Timed out waiting for ASR, MT, and TTS final events", options);
  return matched;
}

async function waitForObservedEvent(events, input, options) {
  let matched;
  await waitUntil(() => {
    matched = events.slice(input.afterIndex).find(input.predicate);
    return Boolean(matched);
  }, input.timeoutMs, input.message ?? "Timed out waiting for call room event", options);
  return matched;
}

async function readFrames(reader, onFrame, isStopped) {
  try {
    while (!isStopped()) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value) onFrame();
    }
  } finally {
    reader.releaseLock?.();
  }
}

function pcm16Samples(buffer) {
  const samples = new Int16Array(Math.floor(buffer.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2);
  }
  return samples;
}

function isWorkerParticipant(participant) {
  if (typeof participant?.identity === "string" &&
      participant.identity.split(":").includes("worker")) return true;
  if (typeof participant?.metadata !== "string") return false;
  try {
    return JSON.parse(participant.metadata).participantRole === "worker";
  } catch {
    return false;
  }
}

function trackName(track, publication) {
  return publication?.name ?? publication?.trackName ?? track?.name ?? "";
}

function ttsTrackPattern(role) {
  return new RegExp(`^translation-tts-${role}-(16000|24000)\\.[A-Za-z0-9_-]+$`);
}

async function waitUntil(predicate, timeoutMs, message, options) {
  const nowMs = options.nowMs ?? Date.now;
  const deadline = nowMs() + timeoutMs;
  while (nowMs() < deadline) {
    if (predicate()) return;
    await (options.sleep ?? sleep)(25);
  }
  throw new Error(message);
}

async function abortableDelay(ms, signal, sleepFn = sleep) {
  if (!signal) return sleepFn(ms);
  throwIfAborted(signal);
  await new Promise((resolve, reject) => {
    const aborted = () => reject(
      signal.reason ?? new Error("Translation load session aborted"),
    );
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(sleepFn(ms)).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Translation load session aborted");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
