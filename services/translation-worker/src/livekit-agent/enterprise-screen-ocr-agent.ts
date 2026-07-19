import { AutoSubscribe, type JobContext } from "@livekit/agents";
import pino from "pino";
import { createEnvironmentScreenOcrProvider } from
  "../providers/http-screen-ocr-provider.js";
import type { TranslationAgentProcessData } from
  "./translation-agent-definition.js";
import {
  EnterpriseScreenOcrRuntimeClient,
  enterpriseMeetingRoomName,
  type EnterpriseScreenOcrTicket,
} from "./enterprise-screen-ocr-runtime-client.js";
import { EnterpriseScreenOcrSource } from "./enterprise-screen-ocr-source.js";

const logger = pino({ name: "enterprise-screen-ocr-agent" });

export async function runEnterpriseScreenOcrAgent(
  ctx: JobContext<TranslationAgentProcessData>,
  ticket: EnterpriseScreenOcrTicket,
) {
  const roomName = enterpriseMeetingRoomName(ticket.communicationSessionId);
  const agentName = process.env.LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME?.trim() ||
    process.env.LIVEKIT_TRANSLATION_AGENT_NAME?.trim() || "translation-runtime";
  if (ctx.job.agentName !== agentName || ctx.job.room?.name !== roomName) {
    throw new Error("Enterprise screen OCR dispatch binding failed");
  }
  const provider = createEnvironmentScreenOcrProvider();
  if (!provider) throw new Error("Enterprise screen OCR Provider not configured");
  const env = ctx.proc.userData.env;
  const client = new EnterpriseScreenOcrRuntimeClient({
    apiBaseUrl: env.apiBaseUrl, internalApiSecret: env.internalApiSecret,
    timeoutMs: env.apiTimeoutMs, ticket,
  });
  await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_NONE);
  const snapshot = await client.snapshot() as { status: "accepted"; run: {
    id: string; meetingId: string; shareId: string; shareGeneration: number;
    targetLanguage: "zh" | "en";
  } };
  if (snapshot.status !== "accepted" || snapshot.run.id !== ticket.runId ||
    snapshot.run.meetingId !== ticket.meetingId ||
    snapshot.run.shareId !== ticket.shareId ||
    snapshot.run.shareGeneration !== ticket.shareGeneration ||
    snapshot.run.targetLanguage !== ticket.targetLanguage) {
    throw new Error("Enterprise screen OCR snapshot binding failed");
  }
  const source = new EnterpriseScreenOcrSource({
    room: ctx.room, ticket, client, provider,
    sampleIntervalMs: integer(
      process.env.ENTERPRISE_SCREEN_OCR_SAMPLE_INTERVAL_MS, 1_500, 1_000, 2_000,
    ),
    maxRawBytes: integer(
      process.env.ENTERPRISE_SCREEN_OCR_MAX_RAW_BYTES,
      16 * 1024 * 1024, 1024 * 1024, 64 * 1024 * 1024,
    ),
  });
  const refresh = guardedInterval(
    () => client.refresh(),
    Math.max(30_000, Math.min(120_000,
      Math.floor((Date.parse(ticket.expiresAt) - Date.now()) / 2))),
    (error) => {
      logger.error({ err: error }, "Enterprise screen OCR fence refresh failed");
      source.stop();
      void client.failRun("screen_ocr_worker_fence_lost").catch(() => undefined);
    },
  );
  ctx.addShutdownCallback(async () => { source.stop(); clearInterval(refresh); });
  try {
    logger.info({ meetingId: ticket.meetingId, runId: ticket.runId,
      shareId: ticket.shareId, shareGeneration: ticket.shareGeneration },
    "Enterprise screen OCR Agent joined room");
    await source.run();
  } catch (error) {
    await client.failRun(screenOcrFailureReason(error)).catch(() => undefined);
    throw error;
  } finally {
    clearInterval(refresh);
    source.stop();
  }
}

function screenOcrFailureReason(error: unknown) {
  return error instanceof Error && error.message.includes("track authorization timed out")
    ? "screen_ocr_track_unavailable" : "screen_ocr_worker_failed";
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
    void operation().catch(onError).finally(() => { running = false; });
  }, intervalMs);
}

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed : fallback;
}
