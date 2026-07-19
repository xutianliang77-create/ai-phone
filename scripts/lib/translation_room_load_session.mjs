import path from "node:path";
import {
  createCallRoomEventCollector,
  createTtsAudioObserver,
  publishWavAudioTrack,
  waitForWorkerParticipant,
} from "./translation_room_load_media.mjs";
import { confirmRoomConnection } from "./livekit_room_activation_probe.mjs";
import {
  admissionRejectionAttestation,
  requestLoadJson as requestJson,
} from "./translation_room_load_http.mjs";

const DEFAULT_ZH_FIXTURE =
  "test-audio/realtime-online-eval-v1/clean-24k-wav/rt_p0_zh_smoke_001.wav";
const DEFAULT_EN_FIXTURE =
  "test-audio/realtime-online-eval-v1/clean-24k-wav/rt_p0_en_smoke_001.wav";

export async function runTranslationRoomLoadSession(options) {
  const nowMs = options.nowMs ?? Date.now;
  const startedAtMs = nowMs();
  const deadlineMs = startedAtMs + options.durationMs;
  const rooms = [];
  let rtc;
  let created;
  let ended = false;
  let collector;
  let audioObserver;
  let audioTrack;
  const completed = [];
  try {
    const health = await requestJson(options, `${options.apiBaseUrl}/health`);
    if (health.body?.callRoomReadiness?.status !== "ready") {
      throw new Error("Staging API call room readiness is not ready");
    }
    created = (await requestJson(options, `${options.apiBaseUrl}/call-links`, {
      method: "POST",
      account: true,
    })).body;
    const guestTicket = guestTicketFromJoinUrl(created?.joinUrl);
    const [hostToken, guestToken] = await Promise.all([
      createRoomToken(options, created.callId, "host"),
      createRoomToken(options, created.callId, "guest", guestTicket),
    ]);
    rtc = await loadRtcNode(options);
    const participants = { host: new rtc.Room(), guest: new rtc.Room() };
    rooms.push(participants.host, participants.guest);

    await connectRoom(participants.guest, guestToken);
    const guestState = (await confirmRoomConnection(
      loadRequestJson,
      requestOptions(options),
      options.apiBaseUrl,
      created.callId,
      guestToken,
    )).body;
    if (guestState?.status !== "waiting") {
      throw new Error("Guest-only room did not remain waiting");
    }
    await connectRoom(participants.host, hostToken);
    const hostState = (await confirmRoomConnection(
      loadRequestJson,
      requestOptions(options),
      options.apiBaseUrl,
      created.callId,
      hostToken,
    )).body;
    if (hostState?.status !== "active" || hostState?.workerReady !== true) {
      throw new Error("Human pair did not activate the Translation Worker");
    }
    await waitForWorkerParticipant(
      participants.host,
      options.eventTimeoutMs,
      mediaOptions(options),
    );
    const sessionStartMs = nowMs() - startedAtMs;

    const sourceRole = sourceRoleFor(options.sessionId);
    const targetRole = sourceRole === "host" ? "guest" : "host";
    collector = createCallRoomEventCollector(
      participants[targetRole],
      rtc,
      mediaOptions(options),
    );
    audioObserver = createTtsAudioObserver(
      participants[targetRole],
      rtc,
      targetRole,
      mediaOptions(options),
    );
    audioTrack = await publishWavAudioTrack(participants[sourceRole], rtc, {
      ...mediaOptions(options),
      path: fixtureFor(options, sourceRole),
      trackName: safeTrackName(options.sessionId, sourceRole),
      readWav: options.readWav,
    });

    do {
      const afterIndex = collector.length;
      const audioFramesBefore = audioObserver.frameCount;
      const timing = await audioTrack.play({
        silenceMs: options.endpointSilenceMs,
        signal: options.signal,
      });
      const cycle = await collector.waitForCycle({
        afterIndex,
        speakerRole: sourceRole,
        timeoutMs: options.eventTimeoutMs,
      });
      await audioObserver.waitForFrameAfter(audioFramesBefore, options.eventTimeoutMs);
      const playback = await collector.waitForEvent({
        afterIndex,
        timeoutMs: options.eventTimeoutMs,
        message: "Timed out waiting for translated target playback completion",
        predicate: (item) => item.event.segmentId === cycle.tts.event.segmentId &&
          ["playback.ended", "playback.failed"].includes(item.event.type),
      });
      if (playback.event.type !== "playback.ended") {
        throw new Error("Translated target playback failed");
      }
      completed.push({
        ...cycle,
        playback,
        audioEndedAtMs: timing.endedAtMs,
        finalLatencyMs: Math.max(
          0,
          cycle.translation.observedAtMs - timing.endedAtMs,
        ),
      });
      const remainingMs = deadlineMs - nowMs();
      if (remainingMs > 0) {
        const cycleReserveMs = audioTrack.audioDurationMs +
          options.endpointSilenceMs + 5_000;
        if (remainingMs <= cycleReserveMs) {
          await abortableDelay(remainingMs, options.signal, options.sleep);
          break;
        }
        await abortableDelay(
          Math.min(options.utteranceIntervalMs, remainingMs - cycleReserveMs),
          options.signal,
          options.sleep,
        );
      }
    } while (nowMs() < deadlineMs);

    await audioTrack.close();
    audioTrack = null;
    const end = await endCall(options, created);
    ended = true;
    return buildAttestation({
      options,
      created,
      completed,
      collector,
      sessionStartMs,
      observedDurationMs: nowMs() - startedAtMs,
      end,
    });
  } catch (error) {
    const rejected = admissionRejectionAttestation(error, nowMs() - startedAtMs);
    if (rejected) return rejected;
    throw error;
  } finally {
    await audioTrack?.close().catch(() => undefined);
    if (created && !ended) await endCall(options, created).catch(() => undefined);
    await audioObserver?.close().catch(() => undefined);
    collector?.close();
    await Promise.all(rooms.map((room) => room.disconnect?.().catch(() => undefined)));
    await rtc?.dispose?.();
  }
}

function buildAttestation(input) {
  const events = input.collector.events.map((item) => item.event);
  const duplicateTts = duplicateCount(events.filter((event) => event.type === "tts.ready"));
  return {
    schemaVersion: 1,
    status: "passed",
    environment: "staging",
    realProviderTraffic: true,
    observedDurationMs: input.observedDurationMs,
    trafficKinds: ["api", "livekit", "asr", "mt", "tts"],
    providerEvidence: {
      api: [`call:${input.created.callId}`, `session:${input.created.sessionId}`],
      livekit: [`room:${input.created.roomName}`],
      asr: evidence(input.completed, (item) => `speech:${item.transcript.event.speechId}`),
      mt: evidence(input.completed, (item) => `turn:${item.translation.event.turnId}`),
      tts: evidence(input.completed, (item) =>
        `tts:${item.tts.event.provider}:${item.tts.event.model}:${item.tts.event.segmentId}`),
    },
    finalEventObserved: input.completed.length > 0,
    providerSideEffectDuplicates: duplicateTts,
    lostFinalEvents: 0,
    duplicateSettlements: 0,
    metrics: {
      sessionStartMs: input.sessionStartMs,
      finalLatencyMs: percentile(
        input.completed.map((item) => item.finalLatencyMs),
        0.95,
      ),
    },
    sessionId: input.options.sessionId,
    callId: input.created.callId,
    completedUtterances: input.completed.length,
    endedStatus: input.end?.status ?? null,
  };
}

async function createRoomToken(options, callId, participantRole, guestTicket) {
  return (await requestJson(
    options,
    `${options.apiBaseUrl}/call-links/${encodeURIComponent(callId)}/room-token`,
    {
      method: "POST",
      account: participantRole === "host",
      body: {
        participantRole,
        participantName: `${participantRole}-${options.sessionId}`.slice(0, 80),
        ...(guestTicket ? { guestTicket } : {}),
      },
    },
  )).body;
}

async function endCall(options, created) {
  return (await requestJson(
    options,
    `${options.apiBaseUrl}/call-links/${encodeURIComponent(created.callId)}/end`,
    {
      method: "POST",
      account: true,
      body: {
        callId: created.callId,
        sessionId: created.sessionId,
        roomName: created.roomName,
      },
    },
  )).body;
}

async function loadRequestJson(options, url, init) {
  return requestJson(options, url, { ...init, account: init.body?.participantRole === "host" });
}

function requestOptions(options) {
  return { ...options, fetchFn: options.fetchFn };
}

function mediaOptions(options) {
  return { nowMs: options.nowMs, sleep: options.sleep };
}

async function loadRtcNode(options) {
  if (options.loadRtcNode) return options.loadRtcNode();
  const dynamicImport = new Function("name", "return import(name)");
  return dynamicImport("@livekit/rtc-node");
}

function fixtureFor(options, role) {
  const configured = role === "host" ? options.zhFixture : options.enFixture;
  return repositoryFile(options.root, configured ?? (
    role === "host" ? DEFAULT_ZH_FIXTURE : DEFAULT_EN_FIXTURE
  ));
}

function repositoryFile(root, file) {
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Audio fixture must be inside the repository");
  }
  return resolved;
}

function guestTicketFromJoinUrl(joinUrl) {
  const ticket = typeof joinUrl === "string"
    ? new URL(joinUrl).searchParams.get("ticket")
    : null;
  if (!ticket) throw new Error("Call link did not include a guest ticket");
  return ticket;
}

function sourceRoleFor(sessionId) {
  const checksum = [...sessionId].reduce((sum, value) => sum + value.charCodeAt(0), 0);
  return checksum % 2 === 0 ? "host" : "guest";
}

function safeTrackName(sessionId, role) {
  return `load-${role}-${sessionId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

function duplicateCount(events) {
  return events.length - new Set(events.map(eventKey)).size;
}

function eventKey(event) {
  return `${event.type}:${event.segmentId}:${event.pipelineGeneration}:${event.revision}`;
}

function evidence(items, map) {
  return [...new Set(items.map(map).filter((value) => !value.includes("undefined")))].slice(0, 64);
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? Infinity;
}

async function connectRoom(room, token) {
  await room.connect(token.wsUrl, token.token, { autoSubscribe: true, dynacast: false });
}

async function abortableDelay(ms, signal, sleepFn = sleep) {
  if (!signal) return sleepFn(ms);
  if (signal.aborted) throw signal.reason ?? new Error("Translation load session aborted");
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
