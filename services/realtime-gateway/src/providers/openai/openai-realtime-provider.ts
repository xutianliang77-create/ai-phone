import WebSocket from "ws";
import type { AudioFrame, ServerRealtimeEvent } from "@translation/contracts";
import { realtimeLogger } from "../../metrics/realtime-metrics.js";
import type {
  RealtimeProvider,
  RealtimeProviderSession,
} from "../realtime-provider.js";
import { mapOpenAiRealtimeEvent } from "./openai-event-mapper.js";

export interface OpenAiRealtimeProviderOptions {
  apiKey: string;
  endpoint: string;
  model: string;
  inputTranscriptionModel: string;
  connectTimeoutMs: number;
}

interface OpenAiSessionState {
  ws: WebSocket;
  ready: Promise<void>;
  context: RealtimeProviderSession;
  events: ServerRealtimeEvent[];
}

export class OpenAiRealtimeProvider implements RealtimeProvider {
  readonly name = "openai";
  private sessions = new Map<string, OpenAiSessionState>();

  constructor(private readonly options: OpenAiRealtimeProviderOptions) {}

  async createSession(context: RealtimeProviderSession) {
    const ws = new WebSocket(this.buildUrl(), {
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });
    const state: OpenAiSessionState = {
      ws,
      context,
      events: [],
      ready: this.waitForOpen(ws),
    };

    ws.on("message", (data) => this.enqueueProviderEvents(state, data.toString()));
    ws.on("error", (error) => {
      realtimeLogger.error({ error }, "OpenAI realtime websocket error");
      state.events.push(providerError(context.sessionId));
    });
    ws.on("close", () => this.sessions.delete(context.sessionId));

    this.sessions.set(context.sessionId, state);
    await state.ready;
    ws.send(JSON.stringify(this.buildSessionUpdate(context)));
  }

  async *sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent> {
    const state = this.sessions.get(frame.sessionId);
    if (!state) {
      yield providerError(frame.sessionId, "OpenAI realtime session was not found");
      return;
    }
    if (frame.sampleRate !== 24000) {
      yield providerError(frame.sessionId, "OpenAI realtime translation requires 24 kHz PCM16 audio");
      return;
    }
    await state.ready;
    if (state.ws.readyState !== WebSocket.OPEN) {
      yield providerError(frame.sessionId);
      return;
    }

    state.ws.send(JSON.stringify({
      type: "session.input_audio_buffer.append",
      audio: frame.data,
    }));
    yield* this.drainEvents(state);
  }

  async closeSession(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (state.ws.readyState === WebSocket.OPEN) state.ws.close();
    this.sessions.delete(sessionId);
  }

  async healthCheck() {
    return true;
  }

  private buildUrl() {
    const url = new URL(this.options.endpoint);
    url.searchParams.set("model", this.options.model);
    return url.toString();
  }

  private buildSessionUpdate(context: RealtimeProviderSession) {
    return {
      type: "session.update",
      session: {
        type: "realtime",
        instructions: buildTranslationInstructions(context),
        audio: {
          input: {
            transcription: { model: this.options.inputTranscriptionModel },
            turn_detection: { type: "server_vad" },
          },
          output: {
            language: context.targetLanguage,
            ...(context.voiceOutput ? { voice: "alloy" } : {}),
          },
        },
      },
    };
  }

  private waitForOpen(ws: WebSocket) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("OpenAI realtime websocket connection timed out"));
      }, this.options.connectTimeoutMs);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private enqueueProviderEvents(state: OpenAiSessionState, raw: string) {
    try {
      const event = JSON.parse(raw) as Record<string, unknown>;
      state.events.push(...mapOpenAiRealtimeEvent(event, state.context));
    } catch {
      state.events.push(providerError(state.context.sessionId));
    }
  }

  private *drainEvents(state: OpenAiSessionState) {
    while (state.events.length > 0) {
      const event = state.events.shift();
      if (event) yield event;
    }
  }
}

function buildTranslationInstructions(context: RealtimeProviderSession) {
  const source = context.sourceLanguage === "auto" ? "auto-detected speech" : context.sourceLanguage;
  return `Translate ${source} into ${context.targetLanguage}. Keep meaning, tone, and names intact.`;
}

function providerError(sessionId: string, message = "OpenAI realtime translation is unavailable"): ServerRealtimeEvent {
  return {
    type: "error",
    sessionId,
    code: "provider_unavailable",
    message,
  };
}
