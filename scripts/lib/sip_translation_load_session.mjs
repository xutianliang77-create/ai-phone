import path from "node:path";
import {
  createCallRoomEventCollector,
  publishWavAudioTrack,
  waitForWorkerParticipant,
} from "./translation_room_load_media.mjs";
import {
  admissionRejectionAttestation,
  requestLoadJson as requestJson,
} from "./translation_room_load_http.mjs";
import { redactPhoneNumbers } from "./phone_redaction.mjs";

const DEFAULT_FIXTURE =
  "test-audio/realtime-online-eval-v1/clean-24k-wav/rt_p0_zh_smoke_001.wav";

export async function runSipTranslationLoadSession(options) {
  const nowMs = options.nowMs ?? Date.now;
  const startedAtMs = nowMs();
  const deadlineMs = startedAtMs + options.durationMs;
  let rtc;
  let room;
  let created;
  let dial;
  let hungUp = false;
  let ended = false;
  let collector;
  let audioTrack;
  const completed = [];
  try {
    const health = (await requestJson(options, `${options.apiBaseUrl}/health`)).body;
    if (health?.callRoomReadiness?.status !== "ready" ||
      health?.pstnReadiness?.status !== "ready" ||
      health?.pstnReadiness?.provider !== "livekit_sip") {
      throw new Error("Staging LiveKit room or SIP readiness is not ready");
    }
    created = (await requestJson(options, `${options.apiBaseUrl}/call-links`, {
      method: "POST",
      account: true,
    })).body;
    const hostToken = (await requestJson(
      options,
      `${options.apiBaseUrl}/call-links/${encodeURIComponent(created.callId)}/room-token`,
      {
        method: "POST",
        account: true,
        body: {
          participantRole: "host",
          participantName: `host-${options.sessionId}`.slice(0, 80),
        },
      },
    )).body;
    rtc = await loadRtcNode(options);
    room = new rtc.Room();
    await room.connect(hostToken.wsUrl, hostToken.token, {
      autoSubscribe: true,
      dynacast: false,
    });
    const hostState = (await requestJson(
      options,
      `${options.apiBaseUrl}/call-links/${encodeURIComponent(created.callId)}/room-connected`,
      {
        method: "POST",
        account: true,
        body: {
          participantIdentity: hostToken.participantIdentity,
          participantRole: "host",
          token: hostToken.token,
        },
      },
    )).body;
    if (hostState?.status !== "waiting") {
      throw new Error("Host-only SIP room did not remain waiting before dial");
    }

    const request = dialRequest(options.targetPhone);
    dial = await requestDial(options, created.callId, request);
    if (!dial.operationId || !["accepted", "active", "unknown"].includes(dial.status)) {
      throw new Error("LiveKit SIP outbound operation was not accepted");
    }
    const replay = await requestDial(options, created.callId, request);
    if (replay.operationId !== dial.operationId || replay.replayed !== true) {
      throw new Error("SIP outbound idempotency replay gate failed");
    }
    dial = await waitForActiveDial(options, created.callId, request, {
      ...replay,
      participantIdentity: dial.participantIdentity,
    });
    await Promise.all([
      waitForWorkerParticipant(room, options.eventTimeoutMs, mediaOptions(options)),
      waitForParticipant(room, dial.participantIdentity, options.eventTimeoutMs, options),
    ]);
    const sessionStartMs = nowMs() - startedAtMs;

    collector = createCallRoomEventCollector(room, rtc, mediaOptions(options));
    audioTrack = await publishWavAudioTrack(room, rtc, {
      ...mediaOptions(options),
      path: repositoryFile(options.root, options.zhFixture ?? DEFAULT_FIXTURE),
      trackName: safeTrackName(options.sessionId),
      readWav: options.readWav,
    });
    do {
      const afterIndex = collector.length;
      const timing = await audioTrack.play({
        silenceMs: options.endpointSilenceMs,
        signal: options.signal,
      });
      const cycle = await collector.waitForCycle({
        afterIndex,
        speakerRole: "host",
        timeoutMs: options.eventTimeoutMs,
      });
      const playback = await collector.waitForEvent({
        afterIndex,
        timeoutMs: options.eventTimeoutMs,
        message: "Timed out waiting for SIP target playback completion",
        predicate: (item) => item.event.segmentId === cycle.tts.event.segmentId &&
          ["playback.ended", "playback.failed"].includes(item.event.type),
      });
      if (playback.event.type !== "playback.ended") {
        throw new Error("Translated SIP target playback failed");
      }
      completed.push({
        ...cycle,
        playback,
        finalLatencyMs: Math.max(0, cycle.translation.observedAtMs - timing.endedAtMs),
      });
      const remainingMs = deadlineMs - nowMs();
      if (remainingMs <= 0) break;
      const reserveMs = audioTrack.audioDurationMs + options.endpointSilenceMs + 5_000;
      if (remainingMs <= reserveMs) {
        await abortableDelay(remainingMs, options);
        break;
      }
      await abortableDelay(
        Math.min(options.utteranceIntervalMs, remainingMs - reserveMs),
        options,
      );
    } while (nowMs() < deadlineMs);

    await audioTrack.close();
    audioTrack = null;
    const hangup = await hangupSip(options, created.callId);
    if (hangup.status !== "succeeded") {
      throw new Error("SIP hangup did not reach a succeeded provider operation");
    }
    hungUp = true;
    const end = await endCall(options, created);
    ended = true;
    return buildAttestation({
      options,
      created,
      dial,
      completed,
      collector,
      sessionStartMs,
      observedDurationMs: nowMs() - startedAtMs,
      end,
      hangup,
    });
  } catch (error) {
    const rejected = admissionRejectionAttestation(error, nowMs() - startedAtMs);
    if (rejected) return rejected;
    throw error;
  } finally {
    await audioTrack?.close().catch(() => undefined);
    if (created && dial && !hungUp) {
      await hangupSip(options, created.callId).catch(() => undefined);
    }
    if (created && !ended) await endCall(options, created).catch(() => undefined);
    collector?.close();
    await room?.disconnect?.().catch(() => undefined);
    await rtc?.dispose?.();
  }
}

function buildAttestation(input) {
  const ttsEvents = input.collector.events
    .map((item) => item.event).filter((event) => event.type === "tts.ready");
  return {
    schemaVersion: 1,
    status: "passed",
    environment: "staging",
    realProviderTraffic: true,
    observedDurationMs: input.observedDurationMs,
    trafficKinds: ["api", "livekit", "sip", "asr", "mt", "tts"],
    providerEvidence: {
      api: [`call:${input.created.callId}`, `session:${input.created.sessionId}`],
      livekit: [`room:${input.created.roomName}`],
      sip: evidence([
        `operation:${input.dial.operationId}`,
        `provider-call:${input.dial.providerCallId}`,
        `participant:${input.dial.participantIdentity}`,
        `hangup:${input.hangup.operationId}`,
      ], input.options.targetPhone),
      asr: evidence(input.completed.map((item) =>
        `speech:${item.transcript.event.speechId}`)),
      mt: evidence(input.completed.map((item) =>
        `turn:${item.translation.event.turnId}`)),
      tts: evidence(input.completed.map((item) =>
        `playback:${item.playback.event.playbackId}:${item.tts.event.provider}:` +
          `${item.tts.event.model}`)),
    },
    finalEventObserved: input.completed.length > 0,
    providerSideEffectDuplicates: ttsEvents.length -
      new Set(ttsEvents.map(eventKey)).size,
    lostFinalEvents: 0,
    duplicateSettlements: 0,
    metrics: {
      sessionStartMs: input.sessionStartMs,
      finalLatencyMs: percentile(input.completed.map((item) => item.finalLatencyMs), 0.95),
    },
    sessionId: input.options.sessionId,
    callId: input.created.callId,
    completedUtterances: input.completed.length,
    endedStatus: input.end?.status ?? null,
  };
}

async function waitForActiveDial(options, callId, request, initial) {
  let current = initial;
  const deadline = (options.nowMs ?? Date.now)() + options.answerTimeoutMs;
  while (current.status !== "active" && (options.nowMs ?? Date.now)() < deadline) {
    await abortableDelay(options.statusPollMs, options);
    current = {
      ...await requestDial(options, callId, request),
      participantIdentity: current.participantIdentity ?? initial.participantIdentity,
    };
    if (current.operationId !== initial.operationId || current.replayed !== true) {
      throw new Error("SIP reconciliation replay changed the outbound operation");
    }
    if (["failed", "cancelled", "succeeded"].includes(current.status)) break;
  }
  if (current.status !== "active" || !current.participantIdentity) {
    throw new Error(`SIP call did not become active; status=${current.status}`);
  }
  return current;
}

function requestDial(options, callId, body) {
  return requestJson(options,
    `${options.apiBaseUrl}/call-links/${encodeURIComponent(callId)}/sip-outbound`,
    { method: "POST", account: true, body }).then((result) => result.body);
}

function hangupSip(options, callId) {
  return requestJson(options,
    `${options.apiBaseUrl}/call-links/${encodeURIComponent(callId)}/sip-hangup`,
    { method: "POST", account: true }).then((result) => result.body);
}

function endCall(options, created) {
  return requestJson(options,
    `${options.apiBaseUrl}/call-links/${encodeURIComponent(created.callId)}/end`, {
      method: "POST",
      account: true,
      body: {
        callId: created.callId,
        sessionId: created.sessionId,
        roomName: created.roomName,
      },
    }).then((result) => result.body);
}

async function waitForParticipant(room, identity, timeoutMs, options) {
  const deadline = (options.nowMs ?? Date.now)() + timeoutMs;
  while ((options.nowMs ?? Date.now)() < deadline) {
    if ([...(room.remoteParticipants?.values() ?? [])].some(
      (participant) => participant.identity === identity
    )) return;
    await (options.sleep ?? sleep)(25);
  }
  throw new Error("Active SIP participant was not visible in the LiveKit room");
}

function dialRequest(targetPhone) {
  return {
    targetPhone,
    sourceLanguage: "zh",
    targetLanguage: "en",
    disclosureConfirmed: true,
  };
}

function repositoryFile(root, file) {
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Audio fixture must be inside the repository");
  }
  return resolved;
}

function mediaOptions(options) {
  return { nowMs: options.nowMs, sleep: options.sleep };
}

async function loadRtcNode(options) {
  if (options.loadRtcNode) return options.loadRtcNode();
  const dynamicImport = new Function("name", "return import(name)");
  return dynamicImport("@livekit/rtc-node");
}

function safeTrackName(sessionId) {
  return `load-sip-host-${sessionId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

function eventKey(event) {
  return `${event.type}:${event.segmentId}:${event.pipelineGeneration}:${event.revision}`;
}

function evidence(values, targetPhone = "") {
  return [...new Set(values
    .filter((value) => !value.includes("undefined"))
    .map((value) => redactPhoneNumbers(value, targetPhone)))].slice(0, 64);
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? Infinity;
}

function abortableDelay(ms, options) {
  const sleepFn = options.sleep ?? sleep;
  if (!options.signal) return sleepFn(ms);
  if (options.signal.aborted) {
    throw options.signal.reason ?? new Error("SIP load session aborted");
  }
  return new Promise((resolve, reject) => {
    const aborted = () => reject(options.signal.reason ?? new Error("SIP load session aborted"));
    options.signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(sleepFn(ms)).then(resolve, reject).finally(() => {
      options.signal.removeEventListener("abort", aborted);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
