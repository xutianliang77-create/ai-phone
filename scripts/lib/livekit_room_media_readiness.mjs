import {
  closeTracks,
  disconnectRooms,
  publishGuestAudioTrack,
  publishTranslationTtsTrack,
  rtcMediaReady,
  waitForCallRoomCaption,
  waitForTranslationTtsAudio,
  waitForWorkerAudio,
} from "./livekit_room_media_probe.mjs";
import { confirmRoomConnection } from "./livekit_room_activation_probe.mjs";

export async function checkLiveKitRoomMediaReadiness(options) {
  const checks = [];
  const issues = [];
  const actions = [];
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  let created = null;
  let roomName = null;
  let rtc = null;
  const rooms = [];
  const tracks = [];

  try {
    const health = await requestJson(options, `${apiBaseUrl}/health`);
    const callRoomReady = health.body?.callRoomReadiness?.status === "ready";
    record(checks, "api_call_room_readiness", callRoomReady, {
      callRoomReadiness: health.body?.callRoomReadiness,
    });
    if (!callRoomReady) {
      issues.push("API callRoomReadiness is not ready for LiveKit media.");
    }

    created = (await requestJson(options, `${apiBaseUrl}/call-links`, {
      method: "POST",
    })).body;
    roomName = created?.roomName ?? null;
    record(checks, "call_link_created", Boolean(created?.callId && roomName), {
      callId: created?.callId,
      roomName,
    });

    const hostToken = await createRoomToken(options, apiBaseUrl, created.callId, "host");
    const guestToken = await createRoomToken(
      options,
      apiBaseUrl,
      created.callId,
      "guest",
      guestTicketFromJoinUrl(created.joinUrl),
    );
    const sameRoom = [hostToken, guestToken].every(
      (token) => token?.roomName === roomName,
    );
    record(checks, "room_tokens_created", sameRoom, {
      hostRole: hostToken?.participantRole,
      guestRole: guestToken?.participantRole,
      roomName,
    });
    if (!sameRoom) issues.push("LiveKit room tokens do not target one room.");

    rtc = await loadRtcNode(options);
    const rtcReady = rtcMediaReady(rtc);
    record(checks, "livekit_rtc_media_runtime", rtcReady.ok, rtcReady.details);
    if (!rtcReady.ok) throw new Error("LiveKit RTC media runtime is incomplete.");

    const participants = createParticipantRooms(rtc);
    rooms.push(...Object.values(participants));

    await connectRoom(participants.guest, guestToken);
    const guestConfirmation = (await confirmRoomConnection(
      requestJson,
      options,
      apiBaseUrl,
      created.callId,
      guestToken,
    )).body;
    record(checks, "single_participant_waits", guestConfirmation?.status === "waiting", {
      status: guestConfirmation?.status,
      workerReady: guestConfirmation?.workerReady,
    });
    if (guestConfirmation?.status !== "waiting") {
      issues.push("Call room activated before both human participants connected.");
    }

    await connectRoom(participants.host, hostToken);
    const hostConfirmation = (await confirmRoomConnection(
      requestJson,
      options,
      apiBaseUrl,
      created.callId,
      hostToken,
    )).body;
    const pairActivated = hostConfirmation?.status === "active" &&
      hostConfirmation?.workerReady === true;
    record(checks, "human_pair_activates_worker", pairActivated, {
      status: hostConfirmation?.status,
      workerReady: hostConfirmation?.workerReady,
    });
    if (!pairActivated) {
      issues.push("Call room did not activate after both human participants connected.");
    }

    const workerToken = (await requestJson(options, `${apiBaseUrl}/internal/call-links/${encodeURIComponent(created.callId)}/worker-room-token`, {
      method: "POST",
      body: { participantName: options.workerName ?? "worker-media-readiness" },
      bearerToken: options.internalApiSecret,
    })).body;
    const workerTokenMatches = workerToken?.roomName === roomName &&
      workerToken?.participantRole === "worker";
    record(checks, "worker_test_token_created", workerTokenMatches, {
      workerRole: workerToken?.participantRole,
      roomName: workerToken?.roomName,
    });
    if (!workerTokenMatches) issues.push("Worker test token targets the wrong room.");

    await connectRoom(participants.worker, workerToken);
    record(checks, "participants_joined_room", true, {
      host: identityOf(participants.host),
      guest: identityOf(participants.guest),
      worker: identityOf(participants.worker),
    });

    const serverSegmentId = `server-caption-${Date.now()}`;
    const serverCaptionReceived = waitForCallRoomCaption(
      participants.guest,
      rtc,
      serverSegmentId,
      options,
    );
    const serverCaption = {
      type: "transcript.final",
      segmentId: serverSegmentId,
      speakerRole: "host",
      sourceLanguage: "zh",
      targetLanguage: "en",
      text: "服务器字幕广播检查。",
      sourceText: "服务器字幕广播检查。",
      timestampMs: Date.now(),
    };
    if (options.submitServerCaption) {
      await options.submitServerCaption(serverCaption);
    } else {
      await requestJson(
        options,
        `${apiBaseUrl}/internal/call-links/${encodeURIComponent(created.callId)}/events`,
        {
          method: "POST",
          bearerToken: options.internalApiSecret,
          body: { events: [serverCaption] },
        },
      );
    }
    const serverData = await serverCaptionReceived;
    record(checks, "server_caption_data_received", serverData.ok, serverData.details);
    if (!serverData.ok) issues.push("Guest participant did not receive API server caption.");

    const audioReceived = waitForWorkerAudio(participants.worker, rtc, options);
    tracks.push(await publishGuestAudioTrack(participants.guest, rtc));
    const audio = await audioReceived;
    record(checks, "worker_audio_subscribed", audio.ok, audio.details);
    if (!audio.ok) issues.push("Worker participant did not receive guest audio.");

    const ttsAudioReceived = waitForTranslationTtsAudio(participants.guest, rtc, options);
    tracks.push(await publishTranslationTtsTrack(participants.worker, rtc));
    const ttsAudio = await ttsAudioReceived;
    record(checks, "guest_translation_tts_audio_subscribed", ttsAudio.ok, ttsAudio.details);
    if (!ttsAudio.ok) issues.push("Guest participant did not receive worker TTS audio.");
  } catch (error) {
    issues.push(errorMessage(error));
    record(checks, "unexpected_error", false, { message: errorMessage(error) });
  } finally {
    await closeTracks(tracks);
    await disconnectRooms(rooms);
    await rtc?.dispose?.();
    if (created?.callId) {
      await requestJson(
        options,
        `${apiBaseUrl}/call-links/${encodeURIComponent(created.callId)}/end`,
        { method: "POST" },
      ).catch(() => undefined);
    }
  }

  if (issues.length > 0) {
    actions.push(
      "Start API with LiveKit env, verify Beelink LiveKit reachability, and rerun media readiness.",
    );
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    apiBaseUrl,
    callId: created?.callId ?? null,
    roomName,
    checks,
    issues,
    actions,
  };
}

async function createRoomToken(
  options,
  apiBaseUrl,
  callId,
  participantRole,
  guestTicket,
) {
  return (await requestJson(options, `${apiBaseUrl}/call-links/${encodeURIComponent(callId)}/room-token`, {
    method: "POST",
    body: {
      participantRole,
      participantName: `${participantRole}-media-readiness`,
      ...(participantRole === "guest" ? { guestTicket } : {}),
    },
  })).body;
}

function guestTicketFromJoinUrl(joinUrl) {
  const ticket = typeof joinUrl === "string"
    ? new URL(joinUrl).searchParams.get("ticket")
    : null;
  if (!ticket) throw new Error("Call link did not include a guest ticket");
  return ticket;
}

function createParticipantRooms(rtc) {
  return {
    host: new rtc.Room(),
    guest: new rtc.Room(),
    worker: new rtc.Room(),
  };
}

async function connectRoom(room, token) {
  await room.connect(token.wsUrl, token.token, {
    autoSubscribe: true,
    dynacast: false,
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
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function loadRtcNode(options) {
  if (options.loadRtcNode) return await options.loadRtcNode();
  const dynamicImport = new Function("name", "return import(name)");
  return dynamicImport("@livekit/rtc-node");
}

function identityOf(room) {
  return room.localParticipant?.identity ?? null;
}

function timeoutMs(options) {
  return Number(options.timeoutMs ?? 15000);
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, "");
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
