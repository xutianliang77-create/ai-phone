import { AutoSubscribe, defineAgent, type JobContext } from "@livekit/agents";
import * as rtc from "@livekit/rtc-node";
import pino from "pino";
import { loadEnv, type TranslationWorkerEnv } from "../config/env.js";
import { buildDefaultSpeechPipeline } from "../main.js";
import { HttpCallSipStatusClient } from "../worker/call-sip-status-client.js";
import { HttpCallSipControlClient } from "../worker/call-sip-control-client.js";
import { HttpCallTtsTrackAccessClient } from "../worker/call-tts-track-access-client.js";
import {
  LiveKitCallAudioSource,
  type RtcNodeModule,
  type RtcRoom,
} from "../worker/livekit-call-audio-source.js";
import type { AudioIngestMetrics } from "../worker/audio-ingest-ring-buffer.js";
import {
  parseWorkerDispatchMetadata,
  WorkerDispatchRuntimeClient,
} from "./worker-dispatch-runtime-client.js";
import {
  EnterpriseMeetingRuntimeClient,
  enterpriseMeetingRoomName,
  parseEnterpriseMeetingDispatchMetadata,
  type EnterpriseMeetingDispatchTicket,
} from "./enterprise-meeting-runtime-client.js";
import { EnterpriseMeetingAudioSource } from
  "./enterprise-meeting-audio-source.js";
import { attachSipControlHandler } from "./sip-control-handler.js";

const logger = pino({ name: "translation-livekit-agent" });

interface TranslationAgentProcessData {
  env: TranslationWorkerEnv;
  prewarmedAt: string;
}

export default defineAgent<TranslationAgentProcessData>({
  prewarm(proc) {
    proc.userData = {
      env: loadEnv(),
      prewarmedAt: new Date().toISOString(),
    };
  },
  async entry(ctx) {
    const enterpriseTicket = parseEnterpriseMeetingDispatchMetadata(
      ctx.job.metadata,
    );
    if (enterpriseTicket) {
      await runEnterpriseMeetingAgent(ctx, enterpriseTicket);
      return;
    }
    const ticket = parseWorkerDispatchMetadata(ctx.job.metadata);
    if (!ticket || ctx.job.agentName !== ticket.agentName ||
      ctx.job.room?.name !== ticket.roomName) {
      throw new Error("LiveKit dispatch metadata binding failed");
    }
    const env = ctx.proc.userData.env;
    const runtimeClient = new WorkerDispatchRuntimeClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
    });
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    const participantIdentity = ctx.agent?.identity;
    if (!participantIdentity) throw new Error("LiveKit Agent has no participant identity");
    const snapshot = await runtimeClient.snapshot({
      ticket,
      participantIdentity,
      workerId: ctx.workerId,
      jobId: ctx.job.id,
    });
    if (snapshot.callId !== ticket.callId || snapshot.roomName !== ticket.roomName ||
      snapshot.generation !== ticket.generation) {
      throw new Error("Worker runtime snapshot binding failed");
    }
    attachSipControlHandler({
      room: ctx.room,
      dataReceivedEvent: rtc.RoomEvent.DataReceived,
      callId: snapshot.callId,
      reporter: new HttpCallSipControlClient({
        apiBaseUrl: env.apiBaseUrl,
        internalApiSecret: env.internalApiSecret,
        timeoutMs: env.apiTimeoutMs,
      }),
      onError: (error) => logger.warn({ err: error }, "SIP DTMF control failed"),
    });
    const source = new LiveKitCallAudioSource({
      callId: snapshot.callId,
      worker: buildDefaultSpeechPipeline(),
      audioSampleRate: env.audioSampleRate,
      audioFrameSizeMs: env.audioFrameSizeMs,
      audioIngestMaxFrames: env.audioIngestMaxFrames,
      sipStatusClient: new HttpCallSipStatusClient({
        apiBaseUrl: env.apiBaseUrl,
        internalApiSecret: env.internalApiSecret,
        timeoutMs: env.apiTimeoutMs,
      }),
      ttsTrackAccessClient: new HttpCallTtsTrackAccessClient({
        apiBaseUrl: env.apiBaseUrl,
        internalApiSecret: env.internalApiSecret,
        timeoutMs: env.apiTimeoutMs,
      }),
      onError: (error) =>
        logger.warn({ err: error }, "Translation audio source failed"),
      onCallEnded: (error) => logger.info({
        callId: error.callId,
        code: error.code,
      }, "Translation worker stopped after call ended"),
      onIngestMetrics: (metrics) =>
        logAudioIngestMetrics(metrics, env.audioFrameSizeMs),
    });
    let heartbeat: NodeJS.Timeout | undefined;
    let endingSent = false;
    const sendEnding = async () => {
      if (endingSent) return;
      endingSent = true;
      await runtimeClient.event({
        ticket,
        event: "ending",
        workerId: ctx.workerId,
        jobId: ctx.job.id,
      });
    };
    ctx.addShutdownCallback(async () => {
      if (heartbeat) clearInterval(heartbeat);
      await source.stop();
      await sendEnding().catch((error) => {
        logger.warn({ err: error }, "Worker ending event failed");
      });
    });
    try {
      await source.startInRoom({
        room: ctx.room as unknown as RtcRoom,
        rtc: rtc as unknown as RtcNodeModule,
        participantIdentity,
        ttsVoice: snapshot.ttsVoice,
      });
      await runtimeClient.event({
        ticket,
        event: "ready",
        workerId: ctx.workerId,
        jobId: ctx.job.id,
      });
      heartbeat = startHeartbeat(runtimeClient, {
        ticket,
        workerId: ctx.workerId,
        jobId: ctx.job.id,
      });
      logger.info({
        callId: ticket.callId,
        dispatchId: ctx.job.dispatchId,
        generation: ticket.generation,
      }, "Translation Agent joined call room");
      await source.waitUntilDisconnected();
    } catch (error) {
      await runtimeClient.event({
        ticket,
        event: "failed",
        workerId: ctx.workerId,
        jobId: ctx.job.id,
        errorClass: error instanceof Error ? error.name : "worker_failed",
      }).catch(() => {});
      throw error;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await source.stop();
      await sendEnding().catch(() => {});
    }
  },
});

async function runEnterpriseMeetingAgent(
  ctx: JobContext<TranslationAgentProcessData>,
  ticket: EnterpriseMeetingDispatchTicket,
) {
  const roomName = enterpriseMeetingRoomName(ticket.communicationSessionId);
  if (ctx.job.agentName !== (process.env.LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME
      ?.trim() || process.env.LIVEKIT_TRANSLATION_AGENT_NAME?.trim() ||
      "translation-runtime") || ctx.job.room?.name !== roomName) {
    throw new Error("Enterprise LiveKit dispatch metadata binding failed");
  }
  const env = ctx.proc.userData.env;
  const client = new EnterpriseMeetingRuntimeClient({
    apiBaseUrl: env.apiBaseUrl,
    internalApiSecret: env.internalApiSecret,
    timeoutMs: env.apiTimeoutMs,
    ticket,
    workerId: ctx.workerId,
  });
  await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
  const snapshot = await client.snapshot();
  if (snapshot.communicationSessionId !== ticket.communicationSessionId ||
    snapshot.roomName !== roomName || snapshot.generation !== ticket.generation) {
    throw new Error("Enterprise Worker runtime snapshot binding failed");
  }
  const source = new EnterpriseMeetingAudioSource({
    room: ctx.room as unknown as RtcRoom,
    rtc: rtc as unknown as RtcNodeModule,
    snapshot,
    client,
    sampleRate: env.audioSampleRate,
    frameSizeMs: env.audioFrameSizeMs,
    capacityFrames: env.audioIngestMaxFrames,
    maxTracks: boundedInteger(
      process.env.ENTERPRISE_MEETING_MAX_AUDIO_TRACKS, 32, 2, 256,
    ),
    onError: (error) => logger.warn({ err: error },
      "Enterprise meeting audio track failed"),
  });
  let heartbeat: NodeJS.Timeout | undefined;
  let refresh: NodeJS.Timeout | undefined;
  let outcome: "completed" | "failed" = "completed";
  let finishing: Promise<void> | null = null;
  const finish = (next: "completed" | "failed") => {
    if (next === "failed") outcome = "failed";
    finishing ??= (async () => {
      if (heartbeat) clearInterval(heartbeat);
      if (refresh) clearInterval(refresh);
      await source.stop();
      await client.finalize(outcome);
    })();
    return finishing;
  };
  const failClosed = (error: unknown, operation: string) => {
    outcome = "failed";
    logger.error({ err: error, operation },
      "Enterprise meeting Worker lost its runtime fence");
    void source.stop();
  };
  ctx.addShutdownCallback(async () => {
    await finish(outcome).catch((error) => logger.warn({ err: error },
      "Enterprise meeting Worker finalization failed"));
  });
  try {
    source.start();
    heartbeat = guardedInterval(
      () => client.heartbeat(),
      boundedInteger(process.env.LIVEKIT_DISPATCH_HEARTBEAT_SECONDS, 15, 5, 60)
        * 1_000,
      (error) => failClosed(error, "heartbeat"),
    );
    refresh = guardedInterval(
      () => client.refresh(),
      refreshInterval(ticket.expiresAt),
      (error) => failClosed(error, "refresh"),
    );
    logger.info({
      meetingId: snapshot.meetingId,
      communicationSessionId: snapshot.communicationSessionId,
      generation: snapshot.generation,
      runtimeState: snapshot.runtimeState,
    }, "Enterprise meeting Translation Agent joined room");
    await source.waitUntilDisconnected();
  } catch (error) {
    outcome = "failed";
    throw error;
  } finally {
    await finish(outcome);
  }
}

function guardedInterval(
  operation: () => Promise<unknown>,
  intervalMs: number,
  onError: (error: unknown) => void,
) {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    void operation().catch(onError).finally(() => {
      running = false;
    });
  }, intervalMs);
}

function refreshInterval(expiresAt: string) {
  const remaining = Date.parse(expiresAt) - Date.now();
  return Math.max(10_000, Math.min(120_000, Math.floor(remaining / 2)));
}

function startHeartbeat(
  client: WorkerDispatchRuntimeClient,
  input: Pick<
    Parameters<WorkerDispatchRuntimeClient["event"]>[0],
    "ticket" | "workerId" | "jobId"
  >,
) {
  const seconds = boundedInteger(
    process.env.LIVEKIT_DISPATCH_HEARTBEAT_SECONDS,
    15,
    5,
    60,
  );
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    void client.event({ ...input, event: "heartbeat" })
      .catch((error) => logger.warn({ err: error }, "Worker heartbeat failed"))
      .finally(() => {
        running = false;
      });
  }, seconds * 1000);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function logAudioIngestMetrics(
  metrics: AudioIngestMetrics,
  audioFrameSizeMs: number,
) {
  const data = {
    ...metrics,
    capacityAudioMs: metrics.capacityFrames * audioFrameSizeMs,
  };
  if (metrics.event === "backpressure") {
    if (metrics.backpressureEvents !== 1 && metrics.backpressureEvents % 25 !== 0) {
      return;
    }
    logger.warn(data, "Audio ingest backpressure dropped stale frames");
    return;
  }
  if (metrics.event === "sequence_gap") {
    logger.warn(data, "Audio ingest sequence gap observed");
    return;
  }
  if (metrics.event === "drained" || metrics.event === "stopped") {
    logger.info(data, "Audio ingest leg completed");
    return;
  }
  logger.debug(data, "Audio ingest high watermark changed");
}
