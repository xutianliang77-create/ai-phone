import { AutoSubscribe, defineAgent } from "@livekit/agents";
import pino from "pino";
import {
  loadVoiceAgentRuntimeEnv,
  type VoiceAgentRuntimeEnv,
} from "./config.js";
import { VoiceAgentRuntimeApiClient } from "./runtime-api-client.js";
import { parseVoiceAgentDispatchTicket } from "./runtime-ticket.js";
import { ManagedVoiceAgentSession } from "./voice-agent-session.js";

const logger = pino({ name: "voice-agent-runtime" });

export interface ProcessData {
  env: VoiceAgentRuntimeEnv;
  prewarmedAt: string;
}

export default defineAgent<ProcessData>({
  prewarm(proc) {
    proc.userData = {
      env: loadVoiceAgentRuntimeEnv(),
      prewarmedAt: new Date().toISOString(),
    };
  },
  async entry(ctx) {
    const ticket = parseVoiceAgentDispatchTicket(ctx.job.metadata);
    if (!ticket || ctx.job.agentName !== ticket.agentName ||
      ctx.job.room?.name !== ticket.roomName) {
      throw new Error("Voice Agent dispatch metadata binding failed");
    }
    const env = ctx.proc.userData.env;
    if (ticket.agentName !== env.agentName) {
      throw new Error("Voice Agent dispatch name mismatch");
    }
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    const participantIdentity = ctx.agent?.identity;
    if (!participantIdentity) {
      throw new Error("Voice Agent has no participant identity");
    }
    const api = new VoiceAgentRuntimeApiClient({
      apiBaseUrl: env.apiBaseUrl,
      internalApiSecret: env.internalApiSecret,
      timeoutMs: env.apiTimeoutMs,
    });
    const snapshot = await api.snapshot({
      ticket,
      participantIdentity,
      workerId: ctx.workerId,
      jobId: ctx.job.id,
    });
    if (snapshot.callId !== ticket.callId ||
      snapshot.sessionId !== ticket.sessionId ||
      snapshot.roomName !== ticket.roomName ||
      snapshot.generation !== ticket.generation ||
      snapshot.participantIdentity !== participantIdentity) {
      throw new Error("Voice Agent runtime snapshot binding failed");
    }
    const managed = new ManagedVoiceAgentSession({
      env,
      api,
      ticket,
      snapshot,
      workerId: ctx.workerId,
      jobId: ctx.job.id,
      ctx,
    });
    ctx.addShutdownCallback(async () => {
      await managed.stop();
    });
    try {
      logger.info({
        draftId: snapshot.draftId,
        callId: snapshot.callId,
        generation: snapshot.generation,
      }, "Voice Agent job started");
      await managed.run();
    } catch (error) {
      await managed.stop(
        error instanceof Error ? error.name.slice(0, 80) : "voice_agent_failed",
      );
      throw error;
    } finally {
      await managed.stop();
    }
  },
});
