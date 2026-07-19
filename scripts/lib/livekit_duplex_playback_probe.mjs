import {
  closeTracks,
  disconnectRooms,
  rtcMediaReady,
} from "./livekit_room_media_probe.mjs";
import {
  countFrames,
  DUPLEX_SAMPLE_RATE,
  firstFrequencyAt,
  inRange,
  playbackInput,
  waitForAudioCollector,
} from "./livekit_duplex_playback_audio.mjs";
import { confirmRoomConnection } from "./livekit_room_activation_probe.mjs";

export async function checkLiveKitDuplexPlayback(options) {
  const checks = [];
  const issues = [];
  const apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
  const rooms = [];
  const tracks = [];
  const collectors = [];
  let callId = null;
  let roomName = null;
  let rtc = null;

  try {
    const created = await requestJson(options, `${apiBaseUrl}/call-links`, {
      method: "POST",
    });
    callId = created.callId;
    roomName = created.roomName;
    record(checks, "call_link_created", Boolean(callId && roomName), {
      callId,
      roomName,
    });

    const [hostToken, guestToken] = await Promise.all([
      createRoomToken(options, apiBaseUrl, callId, "host"),
      createRoomToken(options, apiBaseUrl, callId, "guest"),
    ]);

    rtc = await loadRtcNode(options);
    const rtcReady = rtcMediaReady(rtc);
    record(checks, "livekit_rtc_media_runtime", rtcReady.ok, rtcReady.details);
    if (!rtcReady.ok) throw new Error("LiveKit RTC media runtime is incomplete");

    const { LiveKitTtsAudioSink, liveKitTtsTrackName } =
      await loadProductionSink(options);
    const participants = {
      host: new rtc.Room(),
      guest: new rtc.Room(),
      worker: new rtc.Room(),
    };
    rooms.push(...Object.values(participants));
    await connectRoom(participants.guest, guestToken);
    const guestConfirmation = await confirmRoomConnection(
      requestJson,
      options,
      apiBaseUrl,
      callId,
      guestToken,
    );
    const guestWaiting = guestConfirmation?.status === "waiting" &&
      guestConfirmation?.workerReady === false;
    record(checks, "single_participant_waits", guestWaiting, guestConfirmation);
    if (!guestWaiting) {
      issues.push("Call room activated before both human participants connected");
    }

    await connectRoom(participants.host, hostToken);
    const hostConfirmation = await confirmRoomConnection(
      requestJson,
      options,
      apiBaseUrl,
      callId,
      hostToken,
    );
    const pairActivated = hostConfirmation?.status === "active" &&
      hostConfirmation?.workerReady === true;
    record(checks, "human_pair_activates_worker", pairActivated, hostConfirmation);
    if (!pairActivated) {
      issues.push("Call room did not activate after both human participants connected");
    }

    const workerToken = await requestJson(
      options,
      `${apiBaseUrl}/internal/call-links/${encodeURIComponent(callId)}/worker-room-token`,
      {
        method: "POST",
        body: { participantName: "worker-duplex-acceptance" },
        bearerToken: options.internalApiSecret,
      },
    );
    await connectRoom(participants.worker, workerToken);
    record(checks, "participants_joined_room", true, {
      host: participants.host.localParticipant?.identity,
      guest: participants.guest.localParticipant?.identity,
      worker: participants.worker.localParticipant?.identity,
    });

    const hostLegId = hostToken.participantIdentity;
    const guestLegId = guestToken.participantIdentity;
    const hostTrackName = liveKitTtsTrackName("host", DUPLEX_SAMPLE_RATE, hostLegId);
    const guestTrackName = liveKitTtsTrackName("guest", DUPLEX_SAMPLE_RATE, guestLegId);
    const hostCollectorPromise = waitForAudioCollector(
      participants.host,
      rtc,
      hostTrackName,
      options,
    );
    const guestCollectorPromise = waitForAudioCollector(
      participants.guest,
      rtc,
      guestTrackName,
      options,
    );
    const sink = new LiveKitTtsAudioSink({
      room: participants.worker,
      rtc,
      frameSizeMs: 20,
    });

    const hostController = new AbortController();
    const guestOldController = new AbortController();
    const hostPlay = sink.play(playbackInput({
      callId,
      targetLegId: hostLegId,
      targetSpeakerRole: "host",
      sourceSpeakerRole: "guest",
      generation: 1,
      frequency: 660,
      durationMs: 6000,
      controller: hostController,
    }));
    const guestOldPlay = sink.play(playbackInput({
      callId,
      targetLegId: guestLegId,
      targetSpeakerRole: "guest",
      sourceSpeakerRole: "host",
      generation: 1,
      frequency: 440,
      durationMs: 6000,
      controller: guestOldController,
    })).catch((error) => error);

    const [hostCollector, guestCollector] = await Promise.all([
      hostCollectorPromise,
      guestCollectorPromise,
    ]);
    collectors.push(hostCollector, guestCollector);
    await waitUntil(
      () => hostCollector.frames.length >= 4 && guestCollector.frames.length >= 4,
      timeoutMs(options),
      "Timed out waiting for both playback legs",
    );
    record(checks, "bidirectional_playback_started", true, {
      hostFrames: hostCollector.frames.length,
      guestFrames: guestCollector.frames.length,
    });

    const cancelledAt = Date.now();
    guestOldController.abort();
    const interrupt = await sink.interrupt({
      callId,
      playbackId: "guest-generation-1",
      generation: 1,
      targetLegId: guestLegId,
      targetSpeakerRole: "guest",
      reason: "barge_in",
      idempotencyKey: `acceptance:${callId}:guest:1`,
    });
    await guestOldPlay;
    record(checks, "guest_leg_cleared", interrupt.cleared, { cancelledAt });
    if (!interrupt.cleared) issues.push("Guest target leg could not be cleared");

    const guestNewController = new AbortController();
    const guestNewPlay = sink.play(playbackInput({
      callId,
      targetLegId: guestLegId,
      targetSpeakerRole: "guest",
      sourceSpeakerRole: "host",
      generation: 2,
      frequency: 880,
      durationMs: 1800,
      controller: guestNewController,
    }));
    await waitUntil(
      () => guestCollector.frames.some((frame) => inRange(frame.frequency, 800, 960)),
      timeoutMs(options),
      "Timed out waiting for restarted guest generation",
    );
    const restartedAt = firstFrequencyAt(guestCollector.frames, 800, 960);

    let staleRejected = false;
    try {
      await sink.play(playbackInput({
        callId,
        targetLegId: guestLegId,
        targetSpeakerRole: "guest",
        sourceSpeakerRole: "host",
        generation: 1,
        frequency: 440,
        durationMs: 400,
        controller: new AbortController(),
      }));
    } catch {
      staleRejected = true;
    }

    await Promise.all([hostPlay, guestNewPlay]);
    await sleep(250);
    const hostBeforeCancel = countFrames(hostCollector.frames, 600, 720, {
      before: cancelledAt,
    });
    const hostAfterCancel = countFrames(hostCollector.frames, 600, 720, {
      after: cancelledAt,
    });
    const staleFrames = countFrames(guestCollector.frames, 380, 500, {
      after: restartedAt,
    });
    record(checks, "host_leg_continued_after_guest_cancel", hostBeforeCancel > 0 && hostAfterCancel > 0, {
      hostBeforeCancel,
      hostAfterCancel,
    });
    record(checks, "stale_generation_rejected", staleRejected && staleFrames === 0, {
      staleRejected,
      staleFrames,
      restartedAt,
    });
    if (hostBeforeCancel === 0 || hostAfterCancel === 0) {
      issues.push("Cancelling guest target leg interrupted host target leg");
    }
    if (!staleRejected || staleFrames !== 0) {
      issues.push("Old guest generation emitted late audio frames");
    }
  } catch (error) {
    issues.push(errorMessage(error));
    record(checks, "unexpected_error", false, { message: errorMessage(error) });
  } finally {
    for (const collector of collectors) await collector.stop();
    await closeTracks(tracks);
    await disconnectRooms(rooms);
    await rtc?.dispose?.();
    if (callId) {
      await requestJson(options, `${apiBaseUrl}/call-links/${encodeURIComponent(callId)}/end`, {
        method: "POST",
      }).catch(() => undefined);
    }
  }

  return {
    status: issues.length === 0 && checks.every((check) => check.status === "pass")
      ? "ready"
      : "not_ready",
    apiBaseUrl,
    callId,
    roomName,
    checks,
    issues,
  };
}

async function createRoomToken(options, apiBaseUrl, callId, participantRole) {
  return requestJson(options, `${apiBaseUrl}/call-links/${encodeURIComponent(callId)}/room-token`, {
    method: "POST",
    body: {
      participantRole,
      participantName: `${participantRole}-duplex-acceptance`,
    },
  });
}

async function requestJson(options, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(options));
  try {
    const response = await (options.fetchFn ?? fetch)(url, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.bearerToken ? { authorization: `Bearer ${init.bearerToken}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `${url} returned HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function loadRtcNode(options) {
  if (options.loadRtcNode) return options.loadRtcNode();
  const dynamicImport = new Function("name", "return import(name)");
  return dynamicImport("@livekit/rtc-node");
}

async function loadProductionSink(options) {
  if (options.loadProductionSink) return options.loadProductionSink();
  return import("../../services/translation-worker/dist/worker/livekit-tts-audio-sink.js");
}

async function connectRoom(room, token) {
  await room.connect(token.wsUrl, token.token, {
    autoSubscribe: true,
    dynacast: false,
  });
}

async function waitUntil(predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(message);
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

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
