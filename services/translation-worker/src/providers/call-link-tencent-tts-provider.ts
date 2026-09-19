import { randomUUID } from "node:crypto";
import {
  TencentTtsWireError,
  streamTencentTtsPcm,
} from "@translation/speech-quality";
import type {
  CallLinkPublicTtsAttemptEvent,
  CallLinkPublicTtsProfile,
} from "@translation/contracts";
import type { ParsedWorkerDispatchTicket, WorkerDispatchRuntimeClient } from
  "../livekit-agent/worker-dispatch-runtime-client.js";
import type {
  CallTtsProvider,
  SynthesizedSpeech,
  TtsStreamEvent,
} from "../worker/types.js";

/**
 * Tencent TTS adapter for the inherited Call Link Worker. It never reads a
 * Tencent SecretId/SecretKey from environment variables: each synthesis gets
 * a short-lived in-process material response bound to this Worker dispatch.
 */
export class CallLinkTencentTtsProvider implements CallTtsProvider {
  private readonly closedCalls = new Set<string>();
  private readonly active = new Map<string, Set<AbortController>>();

  constructor(private readonly options: {
    client: WorkerDispatchRuntimeClient;
    ticket: ParsedWorkerDispatchTicket;
    participantIdentity: string;
    workerId: string;
    jobId: string;
    credentialAccessSecret: string;
    profile: CallLinkPublicTtsProfile;
    socketFactory?: Parameters<typeof streamTencentTtsPcm>[0]["socketFactory"];
  }) {}

  async createCall(callId: string) {
    this.assertCall(callId);
    this.closedCalls.delete(callId);
  }

  async synthesize(
    input: Parameters<CallTtsProvider["synthesize"]>[0],
  ): Promise<SynthesizedSpeech | null> {
    let metadata: SynthesizedSpeech | undefined;
    const chunks: Buffer[] = [];
    let sampleRate: 16000 | 24000 | undefined;
    let durationMs: number | undefined;
    for await (const event of this.synthesizeStream(input)) {
      if (event.type === "metadata") metadata = event.speech;
      if (event.type === "audio_chunk") {
        sampleRate ??= event.audio.sampleRate;
        if (sampleRate !== event.audio.sampleRate) {
          throw new Error("Call Link Tencent TTS changed PCM sample rate");
        }
        chunks.push(Buffer.from(event.audio.data, "base64"));
      }
      if (event.type === "final") durationMs = event.audioDurationMs;
    }
    if (!metadata || !sampleRate || !chunks.length) {
      throw new Error("Call Link Tencent TTS returned no playable audio");
    }
    return {
      ...metadata,
      audioDurationMs: durationMs ?? metadata.audioDurationMs,
      audio: {
        format: "pcm16",
        sampleRate,
        data: Buffer.concat(chunks).toString("base64"),
      },
    };
  }

  async *synthesizeStream(
    input: Parameters<NonNullable<CallTtsProvider["synthesizeStream"]>>[0],
  ): AsyncIterable<TtsStreamEvent> {
    this.validateInput(input);
    const controller = this.bindAbort(input.callId, input.signal);
    let prepared = false;
    let terminal = false;
    let sent = false;
    let attempt: CallLinkPublicTtsAttemptEvent | undefined;
    let material: Awaited<ReturnType<WorkerDispatchRuntimeClient["ttsMaterial"]>> | undefined;
    let totalBytes = 0;
    let sequence = 1;
    try {
      material = await this.options.client.ttsMaterial({
        ticket: this.options.ticket,
        participantIdentity: this.options.participantIdentity,
        workerId: this.options.workerId,
        jobId: this.options.jobId,
        credentialAccessSecret: this.options.credentialAccessSecret,
      });
      if (!sameProfile(material.profile, this.options.profile)) {
        throw new Error("Call Link Tencent TTS material profile changed");
      }
      attempt = {
        callId: input.callId,
        sessionId: this.options.ticket.sessionId,
        attemptId: randomUUID(),
        segmentId: input.segmentId,
        revision: input.revision,
        providerId: "tencent",
        modelId: material.profile.modelId,
        state: "dispatching",
      };
      await this.record(attempt);
      prepared = true;
      this.throwIfClosed(input.callId, controller.signal);
      yield {
        type: "metadata",
        speech: {
          provider: "tencent",
          model: material.profile.modelId,
          voiceMode: "preset",
        },
      };
      const wireMetadata: { requestId?: string } = {};
      for await (const chunk of streamTencentTtsPcm(
        {
          ...material.profile,
          targetLanguage: input.language,
          ...(this.options.socketFactory
            ? { socketFactory: this.options.socketFactory }
            : {}),
        },
        input.text,
        material.credentials,
        controller.signal,
        () => {
          sent = true;
        },
        wireMetadata,
      )) {
        this.throwIfClosed(input.callId, controller.signal);
        totalBytes += chunk.byteLength;
        yield {
          type: "audio_chunk",
          sequence: sequence++,
          audio: {
            format: "pcm16",
            sampleRate: material.profile.sampleRate,
            data: chunk.toString("base64"),
          },
        };
      }
      const audioDurationMs = Math.max(
        1,
        Math.round(totalBytes / 2 / material.profile.sampleRate * 1000),
      );
      await this.record({
        ...attempt,
        state: "confirmed",
        metadata: {
          ...(wireMetadata.requestId ? { requestId: wireMetadata.requestId } : {}),
          usage: { billedCharacters: [...input.text].length },
        },
      });
      terminal = true;
      yield { type: "final", audioDurationMs };
    } catch (error) {
      if (prepared && !terminal && attempt) {
        terminal = true;
        await this.recordTerminal(attempt, error, sent);
      }
      throw error;
    } finally {
      if (prepared && !terminal && attempt) {
        terminal = true;
        await this.recordTerminal(
          attempt,
          new Error("call_link_tts_consumer_stopped"),
          sent,
        );
      }
      this.releaseAbort(input.callId, controller);
      material = undefined;
    }
  }

  async closeCall(callId: string) {
    this.closedCalls.add(callId);
    for (const controller of this.active.get(callId) ?? []) controller.abort();
    this.active.delete(callId);
  }

  private async record(event: CallLinkPublicTtsAttemptEvent) {
    await this.options.client.recordTtsAttempt({
      ticket: this.options.ticket,
      participantIdentity: this.options.participantIdentity,
      workerId: this.options.workerId,
      jobId: this.options.jobId,
      credentialAccessSecret: this.options.credentialAccessSecret,
      event,
    });
  }

  private async recordTerminal(
    attempt: CallLinkPublicTtsAttemptEvent,
    error: unknown,
    sent: boolean,
  ) {
    const outcome = error instanceof TencentTtsWireError
      ? error.outcome : sent ? "uncertain" : "not_sent";
    const failureCode = error instanceof TencentTtsWireError
      ? error.code : error instanceof Error &&
        /^[A-Za-z0-9_.:-]{1,240}$/.test(error.message)
        ? error.message : "call_link_tencent_tts_failed";
    await this.record({ ...attempt, state: outcome, failureCode });
  }

  private validateInput(
    input: Parameters<CallTtsProvider["synthesize"]>[0],
  ) {
    this.assertCall(input.callId);
    if (!input.text.trim() || [...input.text].length > 4096 ||
      !["zh", "en"].includes(input.language) ||
      !validIdentifier(input.segmentId) || !validIdentifier(input.speechId) ||
      !validIdentifier(input.turnId) || !Number.isInteger(input.revision) ||
      input.revision < 0 || !Number.isInteger(input.pipelineGeneration) ||
      input.pipelineGeneration < 1 ||
      (input.voice !== undefined &&
        (input.voice.mode !== "preset" ||
          input.voice.presetId !== this.options.profile.voice ||
          (input.voice.quality !== undefined && input.voice.quality !== "standard") ||
          Object.keys(input.voice).some((key) =>
            !["mode", "presetId", "quality"].includes(key)
          )))) {
      throw new Error("call_link_tencent_tts_input_scope");
    }
  }

  private assertCall(callId: string) {
    if (callId !== this.options.ticket.callId ||
      this.options.ticket.sessionId !== callId) {
      throw new Error("call_link_tencent_tts_session_binding");
    }
  }

  private throwIfClosed(callId: string, signal: AbortSignal) {
    if (signal.aborted || this.closedCalls.has(callId)) {
      throw new Error("call_link_tencent_tts_cancelled");
    }
  }

  private bindAbort(callId: string, source: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort(source.reason);
    if (source.aborted) abort();
    else source.addEventListener("abort", abort, { once: true });
    const set = this.active.get(callId) ?? new Set<AbortController>();
    set.add(controller);
    this.active.set(callId, set);
    controller.signal.addEventListener("abort", () => {
      source.removeEventListener("abort", abort);
    }, { once: true });
    return controller;
  }

  private releaseAbort(callId: string, controller: AbortController) {
    const set = this.active.get(callId);
    if (!set) return;
    controller.abort();
    set.delete(controller);
    if (!set.size) this.active.delete(callId);
  }
}

function sameProfile(
  left: CallLinkPublicTtsProfile,
  right: CallLinkPublicTtsProfile,
) {
  return left.providerId === right.providerId && left.protocol === right.protocol &&
    left.endpoint === right.endpoint && left.modelId === right.modelId &&
    left.appId === right.appId && left.voice === right.voice &&
    left.volume === right.volume && left.timeoutMs === right.timeoutMs &&
    left.sampleRate === right.sampleRate;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
