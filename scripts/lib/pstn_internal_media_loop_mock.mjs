import { createServer } from "node:http";

export function createLoopMockServer() {
  const asrRequests = [];
  const eventRequests = [];
  const audioRequests = [];
  const mediaWriteRequests = [];
  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    if (request.method === "POST" && request.url === "/agent-calls") {
      sendJson(response, 200, {
        status: "in_progress",
        providerCallId: "upstream-call-loop",
        mediaStreamId: "upstream-stream-loop",
      });
      return;
    }
    if (request.method === "POST" && request.url === "/asr/transcribe") {
      asrRequests.push({ body });
      sendJson(response, 200, { segmentId: "seg-loop", text: "hello from phone", language: "en" });
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      sendJson(response, 200, { choices: [{ message: { content: "内部媒体闭环已翻译" } }] });
      return;
    }
    if (request.method === "POST" && request.url === "/tts/synthesize") {
      sendJson(response, 200, {
        provider: "mock-tts",
        model: "mock-phone-voice",
        audio: { format: "pcm16", sampleRate: 16000, data: Buffer.alloc(8).toString("base64") },
      });
      return;
    }
    if (request.method === "POST" && request.url === "/translated-audio") {
      audioRequests.push({ body, headers: authHeader(request) });
      sendJson(response, 200, { status: "played", providerPlaybackId: `upstream-playback-${body.segmentId}` });
      return;
    }
    if (request.method === "POST" && request.url === "/media/write") {
      mediaWriteRequests.push({ body, headers: authHeader(request) });
      sendJson(response, 200, { mediaWriteId: `media-write-${body.segmentId}` });
      return;
    }
    if (request.method === "POST" && request.url === "/internal/call-links/call-loop/events") {
      eventRequests.push({ body, headers: authHeader(request) });
      sendJson(response, 200, {
        status: "ok",
        playbackBindings: playbackBindings(
          body?.events,
          "call-loop:guest",
          "call-loop:host",
        ),
      });
      return;
    }
    sendJson(response, 404, { error: { message: `unexpected ${request.method} ${request.url}` } });
  });
  return { server, asrRequests, eventRequests, audioRequests, mediaWriteRequests };
}

function playbackBindings(events, sourceLegId, targetLegId) {
  return (events ?? []).flatMap((event) =>
    event.type === "playback.queued" && event.playbackId && event.generation
      ? [{ playbackId: event.playbackId, generation: event.generation, sourceLegId, targetLegId }]
      : []
  );
}

export function agentCallPayload() {
  return {
    idempotencyKey: "agent-call:call-loop",
    draftId: "draft-loop",
    callId: "call-loop",
    targetPhone: "+8613800138000",
    objective: "验证内部电话媒体闭环",
    suggestedScript: "您好，这是内部电话媒体闭环测试。",
    language: "zh",
    consentPromptVersion: "cn-agent-v1",
  };
}

export function mediaFramePayload() {
  return {
    callId: "call-loop",
    providerCallId: "upstream-call-loop",
    mediaStreamId: "upstream-stream-loop",
    sourceSpeakerRole: "guest",
    sequence: 1,
    timestampMs: Date.now(),
    provider: "domestic_bridge",
    audio: { encoding: "mulaw8k", sampleRate: 8000, durationMs: 20, data: "/w==" },
  };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function authHeader(request) {
  return { authorization: request.headers.authorization };
}
