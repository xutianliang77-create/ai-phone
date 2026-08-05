#!/usr/bin/env -S npx tsx
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createAirDeviceCallRoomToken } from
  "../services/api-server/src/modules/device-calls/device-call-room-token.ts";
import { createAirDeviceTrackAdmission } from
  "../services/api-server/src/modules/device-calls/device-call-track-admission.ts";
import { createCallRoomToken } from
  "../services/api-server/src/modules/call-links/call-room-token.ts";
import { decodeVuartV1AudioPayload } from
  "../services/air-device-gateway/src/device/vuart-v1-payload.ts";
import { encodeVuartFrame, VuartFrameType } from
  "../services/air-device-gateway/src/device/vuart-frame.ts";
import { loadAirGatewayRtcNodeModule, RtcNodeAirDeviceRoomClient } from
  "../services/air-device-gateway/src/media/rtc-node-air-device-room-client.ts";
import { AirGatewayRoomSession } from
  "../services/air-device-gateway/src/runtime/air-gateway-room-session.ts";
import { AirGatewayTtsUplink } from
  "../services/air-device-gateway/src/runtime/air-gateway-tts-uplink.ts";
import { HttpTtsProvider } from
  "../services/translation-worker/src/providers/http-tts-provider.ts";
import { LiveKitTtsAudioSink } from
  "../services/translation-worker/src/worker/livekit-tts-audio-sink.ts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const json = takeFlag("--json");
const noSave = takeFlag("--no-save");
const help = takeFlag("--help") || takeFlag("-h");
const liveKitEnvFile = path.resolve(root,
  valueFlag("--livekit-env") ?? "infra/livekit-selfhost/.env");
const liveKitUrl = valueFlag("--livekit-url") ?? process.env.LIVEKIT_URL;
const ttsEndpoint = valueFlag("--tts-endpoint") ?? process.env.TTS_HTTP_ENDPOINT;
const timeoutMs = Number(valueFlag("--timeout-ms") ?? 120_000);
const output = path.resolve(root, valueFlag("--output") ??
  ".cache/air780-livekit-tts-bridge.json");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}
if (!liveKitUrl) throw new Error("--livekit-url or LIVEKIT_URL is required");
if (!ttsEndpoint) throw new Error("--tts-endpoint or TTS_HTTP_ENDPOINT is required");
if (!process.env.TTS_HTTP_API_KEY) throw new Error("TTS_HTTP_API_KEY is required");
if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 300_000) {
  throw new Error("--timeout-ms must be 5000-300000");
}

const liveKitEnv = process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET
  ? {}
  : (await import("./lib/domestic_release_env_file_check.mjs"))
    .parseEnvFile(readFileSync(liveKitEnvFile, "utf8"));
process.env.CALL_ROOM_PROVIDER = "livekit";
process.env.LIVEKIT_URL = liveKitUrl;
process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ??
  liveKitEnv.LIVEKIT_API_KEY;
process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ??
  liveKitEnv.LIVEKIT_API_SECRET;
process.env.INTERNAL_API_SECRET = "air780-livekit-probe-internal-only";

const result = {
  generatedAt: new Date().toISOString(),
  ...await runProbe({ liveKitUrl, ttsEndpoint, timeoutMs }),
};
if (!noSave) {
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}
if (json) console.log(JSON.stringify(result, null, 2));
else console.log(`Air780 LiveKit/TTS bridge ${result.status}: ${result.vuartChunks} chunks`);
if (result.status !== "ready") process.exit(1);

async function runProbe(options) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const binding = {
    communicationSessionId: `airlk-${suffix}`,
    providerCallId: `air-call-${suffix}`,
    deviceId: "air780-probe",
    leaseId: `lease-${suffix}`,
    fencingToken: 1,
    callGeneration: 1,
  };
  const roomName = `call_${binding.communicationSessionId}`;
  const targetIdentity = `${binding.communicationSessionId}:guest:air:${binding.deviceId}`;
  const rtc = await loadAirGatewayRtcNodeModule();
  const workerRoom = new rtc.Room();
  const writtenFrames = [];
  let frameSequence = 0;
  const uplink = new AirGatewayTtsUplink({
    transport: { writeFrame: async (frame) => { writtenFrames.push(frame); } },
    nextFrameSequence: () => frameSequence++,
    currentBinding: () => binding,
    carrierConnected: () => true,
    capacityChunks: 8,
  });
  const roomSession = new AirGatewayRoomSession({
    createRoom: () => new RtcNodeAirDeviceRoomClient(rtc),
    onParticipantState: (event) => {
      if (event.liveKitParticipantState === "joined") uplink.resume(event);
      else uplink.suspend(event.callGeneration);
    },
    admitTrack: (request) => createAirDeviceTrackAdmission(request, {
      leaseVerifier: { assertLease: (lease) => {
        if (lease.deviceId !== binding.deviceId ||
          lease.leaseId !== binding.leaseId ||
          lease.fencingToken !== binding.fencingToken) throw new Error("stale lease");
      } },
      callVerifier: { assertCallBinding: (call) => {
        if (call.communicationSessionId !== binding.communicationSessionId ||
          call.callGeneration !== binding.callGeneration) {
          throw new Error("stale call generation");
        }
      } },
      nowMs: Date.now(),
    }),
    onTtsFrame: (frame) => { uplink.accept(frame); },
  });
  let rawTrack;
  let rawSource;
  try {
    const airToken = await createAirDeviceCallRoomToken({
      communicationSessionId: binding.communicationSessionId,
      roomName,
      deviceId: binding.deviceId,
      leaseId: binding.leaseId,
      callGeneration: binding.callGeneration,
    });
    if (!airToken.ok) throw new Error(airToken.issues.join("; "));
    const workerToken = await createCallRoomToken({
      callId: binding.communicationSessionId,
      roomName,
      participantRole: "worker",
      participantName: "air780-livekit-tts-probe",
    });
    if (!workerToken.ok) throw new Error(workerToken.issues.join("; "));
    await roomSession.prepare({
      type: "dial",
      providerOperationId: `operation-${suffix}`,
      commandId: `command-${suffix}`,
      idempotencyKey: `dial-${suffix}`,
      ...binding,
      phoneNumberReference: "+8610010",
      participantIdentity: airToken.participantIdentity,
      roomName,
      roomAccess: { wsUrl: airToken.wsUrl, token: airToken.token,
        expiresAt: airToken.expiresAt },
    });
    await workerRoom.connect(workerToken.wsUrl, workerToken.token, {
      autoSubscribe: false,
      dynacast: false,
    });

    ({ track: rawTrack, source: rawSource } = await publishTrack(
      workerRoom, rtc, "raw-worker-audio",
    ));
    await waitFor(() => roomSession.snapshot().trackRejections >= 1,
      10_000, "raw track rejection");
    await emitFrames(rawSource, rtc, 12);
    await delay(300);
    if (writtenFrames.length !== 0) {
      throw new Error("raw worker audio reached the VUART sink");
    }

    const provider = new HttpTtsProvider({
      endpoint: options.ttsEndpoint,
      apiKey: process.env.TTS_HTTP_API_KEY,
      timeoutMs: options.timeoutMs,
      provider: "voxcpm2",
      model: "VoxCPM2",
    });
    const controller = new AbortController();
    const speech = await provider.synthesize({
      callId: binding.communicationSessionId,
      text: "您好，这是无界AI的LiveKit语音联调。",
      language: "zh",
      speakerRole: "guest",
      segmentId: `segment-${suffix}`,
      speechId: `speech-${suffix}`,
      turnId: `turn-${suffix}`,
      revision: 1,
      pipelineGeneration: 1,
      signal: controller.signal,
    });
    if (!speech?.audio) throw new Error("TTS provider returned no PCM audio");
    const sink = new LiveKitTtsAudioSink({
      room: workerRoom,
      rtc,
      frameSizeMs: 20,
      trackAccess: { authorizeTrack: async (track) => {
        if (track.targetLegId !== targetIdentity ||
          track.targetSpeakerRole !== "guest" ||
          !track.trackSid || !track.trackName.startsWith(
            "translation-tts-guest-")) throw new Error("invalid TTS track access");
      } },
    });
    await sink.play({
      callId: binding.communicationSessionId,
      segmentId: `segment-${suffix}`,
      playbackId: `playback-${suffix}`,
      generation: 1,
      sourceLegId: `${binding.communicationSessionId}:worker:source`,
      targetLegId: targetIdentity,
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "zh",
      speech,
      signal: controller.signal,
    });
    await waitFor(() => writtenFrames.length > 0, 15_000,
      "admitted TTS VUART output");
    await delay(500);
    await uplink.flush();
    const decoded = writtenFrames.map((frame, index) => {
      if (frame.type !== VuartFrameType.AUDIO_UPLINK || frame.sequence !== index) {
        throw new Error("unexpected VUART uplink envelope sequence");
      }
      const audio = decodeVuartV1AudioPayload(frame.payload);
      if (!sameBinding(audio, binding) || audio.mediaSequence !== index ||
        audio.payload.byteLength !== 6_400) {
        throw new Error("unexpected VUART uplink payload binding");
      }
      return audio;
    });
    const vuartPcm = join(decoded.map((audio) => audio.payload));
    if (peakAbs(vuartPcm) === 0) throw new Error("TTS VUART PCM is silent");
    const snapshot = roomSession.snapshot();
    const metrics = uplink.metrics();
    if (snapshot.trackAdmissions !== 1 || snapshot.trackRejections < 1 ||
      metrics.droppedChunks !== 0 || metrics.writeFailures !== 0) {
      throw new Error("LiveKit/TTS isolation or uplink counters are not clean");
    }
    const writesBeforeShutdown = writtenFrames.length;
    await roomSession.shutdown();
    await delay(100);
    const terminalMetrics = uplink.metrics();
    if (terminalMetrics.ready || terminalMetrics.partialFrames !== 0 ||
      terminalMetrics.queuedChunks !== 0 ||
      writtenFrames.length !== writesBeforeShutdown) {
      throw new Error("room shutdown did not clear the TTS uplink");
    }
    return {
      status: "ready",
      transport: "real_livekit_in_memory_vuart_sink",
      liveKitUrl: options.liveKitUrl,
      tts: { provider: speech.provider, model: speech.model,
        sampleRate: speech.audio.sampleRate,
        sourceBytes: Buffer.from(speech.audio.data, "base64").byteLength,
        sourceSha256: sha256(Buffer.from(speech.audio.data, "base64")),
        firstAudioMs: speech.firstAudioMs,
        audioDurationMs: speech.audioDurationMs },
      rawCrossAudioVuartWrites: 0,
      vuartChunks: decoded.length,
      vuartPcmBytes: vuartPcm.byteLength,
      vuartPcmSha256: sha256(vuartPcm),
      firstFrameSha256: sha256(encodeVuartFrame(writtenFrames[0])),
      peakAbs: peakAbs(vuartPcm),
      room: { trackAdmissions: snapshot.trackAdmissions,
        trackRejections: snapshot.trackRejections,
        ttsFramesAccepted: snapshot.ttsFramesAccepted,
        ttsFramesRejected: snapshot.ttsFramesRejected },
      uplink: metrics,
      uplinkAfterRoomShutdown: terminalMetrics,
    };
  } finally {
    rawSource?.clearQueue?.();
    await rawTrack?.close?.(true).catch(() => undefined);
    await roomSession.shutdown().catch(() => undefined);
    if (workerRoom.isConnected) await workerRoom.disconnect().catch(() => undefined);
    await rtc.dispose?.().catch(() => undefined);
  }
}
async function publishTrack(room, rtc, name) {
  const source = new rtc.AudioSource(16_000, 1);
  const track = rtc.LocalAudioTrack.createAudioTrack(name, source);
  const options = new rtc.TrackPublishOptions();
  options.source = rtc.TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(track, options);
  return { source, track };
}
async function emitFrames(source, rtc, count) {
  for (let frame = 0; frame < count; frame += 1) {
    const samples = Int16Array.from({ length: 320 }, (_, index) =>
      Math.round(Math.sin(2 * Math.PI * 440 * (frame * 320 + index) / 16_000) *
        4_000));
    await source.captureFrame(new rtc.AudioFrame(samples, 16_000, 1, 320));
  }
  await source.waitForPlayout?.();
}
function sameBinding(left, right) {
  return left.communicationSessionId === right.communicationSessionId &&
    left.providerCallId === right.providerCallId &&
    left.deviceId === right.deviceId && left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.callGeneration === right.callGeneration;
}
function join(chunks) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) =>
    sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
function peakAbs(pcm) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let peak = 0;
  for (let offset = 0; offset < pcm.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
  }
  return peak;
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function waitFor(predicate, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}
function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}
function usage() {
  console.log(`Usage: scripts/check_air780_livekit_tts_bridge.mjs
  --livekit-url ws://127.0.0.1:7880 --tts-endpoint http://127.0.0.1:8002/tts/synthesize

Requires TTS_HTTP_API_KEY and a private LiveKit env file. Uses real LiveKit and
real TTS, but an in-memory VUART sink: it never opens a serial port or dials.`);
}
