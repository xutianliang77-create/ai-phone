export async function checkCallLinkLiveKitWorkerReadiness(options) {
  const checks = [];
  const issues = [];
  const actions = [];
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  let created = null;
  let hostToken = null;
  let guestToken = null;
  let workerToken = null;

  try {
    const health = await requestJson(options, `${apiBaseUrl}/health`);
    const readiness = health.body?.callRoomReadiness;
    const ready = readiness?.status === "ready" && readiness?.provider === "livekit";
    record(checks, "api_call_room_readiness", ready, readiness);
    if (!ready) {
      issues.push("API callRoomReadiness is not ready for LiveKit.");
      actions.push("Set CALL_ROOM_PROVIDER=livekit, LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the API server.");
    }

    created = (await requestJson(options, `${apiBaseUrl}/call-links`, {
      method: "POST",
    })).body;
    record(checks, "call_link_created", Boolean(created?.callId && created?.sessionId), {
      callId: created?.callId,
      sessionId: created?.sessionId,
      roomName: created?.roomName,
    });

    hostToken = await createRoomToken(options, apiBaseUrl, created.callId, "host");
    guestToken = await createRoomToken(
      options,
      apiBaseUrl,
      created.callId,
      "guest",
      guestTicketFromJoinUrl(created.joinUrl),
    );
    record(checks, "host_guest_room_tokens", tokensJoinSameRoom(hostToken, guestToken, created), {
      hostRole: hostToken?.participantRole,
      guestRole: guestToken?.participantRole,
      roomName: hostToken?.roomName,
    });

    const publicWorker = await requestJson(options, `${apiBaseUrl}/call-links/${encodeURIComponent(created.callId)}/room-token`, {
      method: "POST",
      body: { participantRole: "worker" },
      allowError: true,
    });
    record(checks, "public_worker_token_rejected", publicWorker.status === 400, {
      status: publicWorker.status,
    });
    if (publicWorker.status !== 400) issues.push("Public room-token endpoint did not reject participantRole=worker.");

    workerToken = (await requestJson(options, `${apiBaseUrl}/internal/call-links/${encodeURIComponent(created.callId)}/worker-room-token`, {
      method: "POST",
      body: { participantName: options.participantName ?? "translation-worker-readiness" },
      bearerToken: options.internalApiSecret,
    })).body;
    const tokenPermissions = validateTokenPermissions({ created, hostToken, guestToken, workerToken });
    record(checks, "worker_token_permissions", tokenPermissions.ok, tokenPermissions.details);
    issues.push(...tokenPermissions.issues);

    const rtc = await loadRtcNode(options);
    const requiredRtcExports = [
      "Room",
      "RoomEvent",
      "AudioStream",
      "RemoteAudioTrack",
      "AudioFrame",
      "AudioSource",
      "LocalAudioTrack",
      "TrackPublishOptions",
      "TrackSource",
    ];
    const rtcReady = requiredRtcExports.every(
      (key) => Boolean(rtc?.[key]),
    );
    record(checks, "livekit_rtc_node_runtime", rtcReady, {
      exports: Object.keys(rtc ?? {}).filter((key) =>
        requiredRtcExports.includes(key)
      ),
    });
    if (!rtcReady) {
      issues.push("LiveKit RTC Node runtime is missing required audio subscribe/publish exports.");
    }

    if (!options.diagnosticsAdminToken) {
      record(checks, "smoke_caption_history", false, { reason: "missing diagnostics admin token" });
      issues.push("DIAGNOSTICS_ADMIN_TOKEN is required for smoke caption verification.");
      actions.push("Set DIAGNOSTICS_ADMIN_TOKEN and pass it to the readiness script.");
    } else {
      const smoke = await requestJson(options, `${apiBaseUrl}/call-links/${encodeURIComponent(created.callId)}/worker-smoke-caption`, {
        method: "POST",
        bearerToken: options.diagnosticsAdminToken,
      });
      const session = await requestJson(options, `${apiBaseUrl}/sessions/${encodeURIComponent(created.sessionId)}`);
      const segment = session.body?.segments?.find((item) =>
        item?.sourceText === "hello, this is a call room translation test" &&
        item?.translatedText === "你好，这是一次通话房间翻译测试。"
      );
      const publishedEvents = smoke.body?.publishedEvents ?? [];
      const ok = ["transcript.final", "translation.final", "tts.ready"].every((type) =>
        publishedEvents.includes(type)
      ) && Boolean(segment);
      record(checks, "smoke_caption_history", ok, {
        publishedEvents,
        segmentCount: session.body?.segments?.length ?? 0,
      });
      if (!ok) issues.push("Smoke caption was not published and persisted to call history.");
    }
  } catch (error) {
    issues.push(errorMessage(error));
    record(checks, "unexpected_error", false, { message: errorMessage(error) });
  }

  if (issues.length > 0 && actions.length === 0) {
    actions.push("Start API with real LiveKit configuration, INTERNAL_API_SECRET, and DIAGNOSTICS_ADMIN_TOKEN, then rerun this script.");
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    apiBaseUrl,
    callId: created?.callId ?? null,
    sessionId: created?.sessionId ?? null,
    roomName: created?.roomName ?? workerToken?.roomName ?? null,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
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
      participantName: `${participantRole}-readiness`,
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

function tokensJoinSameRoom(hostToken, guestToken, created) {
  return hostToken?.participantRole === "host" &&
    guestToken?.participantRole === "guest" &&
    hostToken?.roomName === created?.roomName &&
    guestToken?.roomName === created?.roomName;
}

function validateTokenPermissions({ created, hostToken, guestToken, workerToken }) {
  const payloads = {
    host: decodeJwtPayload(hostToken?.token),
    guest: decodeJwtPayload(guestToken?.token),
    worker: decodeJwtPayload(workerToken?.token),
  };
  const issues = [];
  const details = {
    host: payloads.host?.video,
    guest: payloads.guest?.video,
    worker: payloads.worker?.video,
  };
  for (const role of ["host", "guest"]) {
    if (payloads[role]?.video?.room !== created.roomName) issues.push(`${role} token room mismatch.`);
    if (payloads[role]?.video?.canPublish !== true) issues.push(`${role} token cannot publish.`);
    if (payloads[role]?.video?.canSubscribe !== true) issues.push(`${role} token cannot subscribe.`);
  }
  if (payloads.worker?.video?.room !== created.roomName) issues.push("worker token room mismatch.");
  if (payloads.worker?.video?.canPublish !== true) issues.push("worker token cannot publish TTS audio.");
  if (payloads.worker?.video?.canSubscribe !== true) issues.push("worker token cannot subscribe.");
  return { ok: issues.length === 0, issues, details };
}

export function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function requestJson(options, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
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
    if (!response.ok && !init.allowError) {
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

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, "");
}

function errorMessage(error) {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && cause.message && cause.message !== error.message) {
      return `${error.message}: ${cause.message}`;
    }
    return error.message;
  }
  return String(error);
}
