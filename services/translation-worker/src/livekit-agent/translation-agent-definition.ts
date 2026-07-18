import { AutoSubscribe, defineAgent } from "@livekit/agents";
import * as rtc from "@livekit/rtc-node";
import pino from "pino";
import { loadEnv, type TranslationWorkerEnv } from "../config/env.js";
import { buildDefaultSpeechPipeline } from "../main.js";
import { HttpCallSipStatusClient } from "../worker/call-sip-status-client.js";
import { HttpCallSipControlClient } from "../worker/call-sip-control-client.js";
import { HttpCallTtsTrackAccessClient } from "../worker/call-tts-track-access-client.js";
import {
  CallDiagnosticsReporter,
  HttpCallDiagnosticsClient,
} from "../worker/call-diagnostics-client.js";
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
    const diagnostics = new CallDiagnosticsReporter({
      env,
      generation: snapshot.generation,
      client: new HttpCallDiagnosticsClient({
        apiBaseUrl: env.apiBaseUrl,
        internalApiSecret: env.internalApiSecret,
        timeoutMs: env.apiTimeoutMs,
      }),
    });
    const source = new LiveKitCallAudioSource({
      callId: snapshot.callId,
      worker: buildDefaultSpeechPipeline(),
      audioSampleRate: env.audioSampleRate,
      audioFrameSizeMs: env.audioFrameSizeMs,
      audioIngestMaxFrames: env.audioIngestMaxFrames,
      rtcStatsIntervalMs: env.rtcStatsIntervalMs,
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
      onDiagnostics: (report) => diagnostics.report(snapshot.callId, report),
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
