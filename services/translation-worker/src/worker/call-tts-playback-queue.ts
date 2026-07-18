import { runAbortable } from "./abortable-operation.js";
import { KeyedAsyncQueue } from "./keyed-async-queue.js";
import type {
  PlaybackInput,
  PlaybackInterruptionResult,
  PlaybackInterruptReason,
  PlaybackLifecycle,
  PlaybackLifecycleInput,
  PlaybackStartedInput,
} from "./call-tts-playback-types.js";
import { playTtsAudioStream } from "./tts-playback-stream.js";
import type {
  CallAudioSpeakerRole,
  CallPlaybackBinding,
  CallTtsAudioSink,
  CallTtsAudioStream,
} from "./types.js";
export type {
  PlaybackInput,
  PlaybackInterruptionResult,
  PlaybackInterruptReason,
  PlaybackLifecycle,
  PlaybackLifecycleInput,
  PlaybackStartedInput,
} from "./call-tts-playback-types.js";
interface ActivePlayback {
  input: PlaybackStartedInput;
  controller: AbortController;
}
export class CallTtsPlaybackQueue {
  private readonly sinks: CallTtsAudioSink[] = [];
  private readonly routeQueue = new KeyedAsyncQueue();
  private readonly targetQueue = new KeyedAsyncQueue();
  private readonly generations = new Map<string, number>();
  private readonly routeEpochs = new Map<string, number>();
  private readonly active = new Map<string, ActivePlayback>();
  private readonly targetKeys = new Map<string, Set<string>>();

  constructor(
    private readonly onPlaybackError: (input: PlaybackInput) => Promise<void>,
    private readonly onPlaybackStarted?: (input: PlaybackStartedInput) => void,
    private readonly onPlaybackLifecycle?: (
      state: PlaybackLifecycle,
      input: PlaybackLifecycleInput,
    ) => Promise<CallPlaybackBinding | void>,
  ) {}

  addSink(sink: CallTtsAudioSink) {
    this.sinks.push(sink);
  }

  enqueue(input: PlaybackInput) {
    void this.queuePlayback(input).catch(() => undefined);
  }

  enqueueStream(input: PlaybackInput & { audioStream: CallTtsAudioStream }) {
    if (this.sinks.length === 0) return Promise.resolve(false);
    return new Promise<boolean>((resolve, reject) => {
      void this.queuePlayback(input, { resolve, reject }).catch(reject);
    });
  }

  private async queuePlayback(
    input: PlaybackInput,
    consumersReady?: PlaybackConsumersReady,
  ) {
    if (this.sinks.length === 0 || (!input.speech.audio && !input.audioStream)) {
      consumersReady?.resolve(false);
      return;
    }
    const targetSpeakerRole = oppositeSpeakerRole(input.speakerRole);
    const routeKey = targetRouteKey(input.callId, targetSpeakerRole);
    const routeEpoch = this.routeEpoch(routeKey);
    await this.routeQueue.enqueue(routeKey, async () => {
      if (this.routeEpoch(routeKey) !== routeEpoch) {
        consumersReady?.resolve(false);
        return;
      }
      const generation = this.nextGeneration(routeKey);
      const pending: PlaybackLifecycleInput = {
        ...input,
        targetSpeakerRole,
        playbackId: `pb_${input.segmentId}_${generation}`,
        generation,
      };
      const binding = await this.publishLifecycle("queued", pending);
      const routed = bindPlayback(pending, binding);
      const targetKey = targetQueueKey(input.callId, routed.targetLegId);
      this.rememberTargetKey(input.callId, targetKey);
      await this.targetQueue.enqueue(targetKey, async () => {
        if (this.routeEpoch(routeKey) !== routeEpoch) {
          consumersReady?.resolve(false);
          await this.publishLifecycle("interrupted", {
            ...routed,
            playbackReason: "barge_in",
          });
          return;
        }
        await this.play(routed, consumersReady);
      });
    });
  }

  supportsInterruption() {
    return this.sinks.length > 0 && this.sinks.every((sink) =>
      sink.capabilities?.bidirectionalMedia === true &&
      sink.capabilities.clearPlayback === true &&
      Boolean(sink.interrupt)
    );
  }

  activePlaybackForSpeaker(
    callId: string,
    targetSpeakerRole: CallAudioSpeakerRole,
  ) {
    return [...this.active.values()].find((item) =>
      item.input.callId === callId &&
      item.input.targetSpeakerRole === targetSpeakerRole
    )?.input;
  }

  interruptSpeaker(input: {
    callId: string;
    targetSpeakerRole: CallAudioSpeakerRole;
    reason: PlaybackInterruptReason;
  }): Promise<PlaybackInterruptionResult> {
    const active = [...this.active.values()].find((item) =>
      item.input.callId === input.callId &&
      item.input.targetSpeakerRole === input.targetSpeakerRole
    );
    if (!active) {
      if (this.supportsInterruption()) {
        this.advanceRouteEpoch(targetRouteKey(input.callId, input.targetSpeakerRole));
      }
      return Promise.resolve({
        supported: this.supportsInterruption(),
        interrupted: false,
        cleared: false,
      });
    }
    return this.interruptTarget({
      callId: input.callId,
      targetLegId: active.input.targetLegId,
      reason: input.reason,
    });
  }

  async interruptTarget(input: {
    callId: string;
    targetLegId: string;
    reason: PlaybackInterruptReason;
  }): Promise<PlaybackInterruptionResult> {
    const key = targetQueueKey(input.callId, input.targetLegId);
    const active = this.active.get(key);
    const supported = this.supportsInterruption();
    if (!active) return { supported, interrupted: false, cleared: false };
    if (!supported) {
      return {
        supported: false,
        interrupted: false,
        cleared: false,
        playback: active.input,
      };
    }
    this.advanceRouteEpoch(
      targetRouteKey(input.callId, active.input.targetSpeakerRole),
    );
    active.controller.abort();
    const results = await Promise.all(this.sinks.map(async (sink) => {
      try {
        const result = await sink.interrupt!({
          callId: active.input.callId,
          playbackId: active.input.playbackId,
          generation: active.input.generation,
          targetLegId: active.input.targetLegId,
          targetSpeakerRole: active.input.targetSpeakerRole,
          reason: input.reason,
          idempotencyKey: `interrupt:${active.input.playbackId}:${active.input.generation}`,
        });
        return result.cleared;
      } catch {
        return false;
      }
    }));
    const cleared = results.length > 0 && results.every(Boolean);
    if (cleared) {
      await this.publishLifecycle("interrupted", {
        ...active.input,
        playbackReason: input.reason,
      });
    } else {
      await this.publishLifecycle("failed", {
        ...active.input,
        playbackReason: "failure",
      });
    }
    return {
      supported: true,
      interrupted: true,
      cleared,
      playback: active.input,
    };
  }

  async drain(callId: string) {
    await Promise.all([
      this.routeQueue.drain(targetRouteKey(callId, "host")),
      this.routeQueue.drain(targetRouteKey(callId, "guest")),
    ]);
    await Promise.all(
      [...(this.targetKeys.get(callId) ?? [])].map((key) =>
        this.targetQueue.drain(key)
      ),
    );
    this.targetKeys.delete(callId);
  }

  async cancelCall(callId: string, reason: PlaybackInterruptReason) {
    for (const role of ["host", "guest"] as const) {
      this.advanceRouteEpoch(targetRouteKey(callId, role));
    }
    const active = [...this.active.values()].filter(
      (item) => item.input.callId === callId,
    );
    if (!this.supportsInterruption()) {
      for (const item of active) item.controller.abort();
      return;
    }
    await Promise.all(active.map((item) => this.interruptTarget({
      callId,
      targetLegId: item.input.targetLegId,
      reason,
    })));
  }

  private async play(
    input: PlaybackStartedInput,
    consumersReady?: PlaybackConsumersReady,
  ) {
    const key = targetQueueKey(input.callId, input.targetLegId);
    const controller = new AbortController();
    this.active.set(key, { input, controller });
    this.onPlaybackStarted?.(input);
    await this.publishLifecycle("started", input);
    const streams = input.audioStream
      ? this.sinks.map(() => input.audioStream!.subscribe())
      : [];
    consumersReady?.resolve(streams.length > 0);
    const results = await Promise.all(this.sinks.map(async (sink, index) => {
      try {
        const common = {
          callId: input.callId,
          segmentId: input.segmentId,
          playbackId: input.playbackId,
          generation: input.generation,
          sourceLegId: input.sourceLegId,
          targetLegId: input.targetLegId,
          sourceSpeakerRole: input.speakerRole,
          targetSpeakerRole: input.targetSpeakerRole,
          language: input.targetLanguage,
          speech: input.speech,
          signal: controller.signal,
        };
        const result = await runAbortable(controller.signal, () =>
          input.audioStream
            ? playTtsAudioStream(sink, common, streams[index]!)
            : sink.play(common)
        );
        return { failed: false, queued: result?.status === "queued" };
      } catch {
        return { failed: !controller.signal.aborted, queued: false };
      }
    }));
    const failed = results.some((result) => result.failed);
    const queuedOnly = results.some((result) => result.queued);
    if (this.active.get(key)?.input.playbackId === input.playbackId) {
      this.active.delete(key);
    }
    if (controller.signal.aborted) return;
    if (failed) {
      await this.publishLifecycle("failed", {
        ...input,
        playbackReason: "failure",
      });
      await this.onPlaybackError(input);
    } else if (!queuedOnly) {
      await this.publishLifecycle("ended", input);
    }
  }

  private nextGeneration(key: string) {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return generation;
  }

  private routeEpoch(key: string) {
    return this.routeEpochs.get(key) ?? 0;
  }

  private advanceRouteEpoch(key: string) {
    this.routeEpochs.set(key, this.routeEpoch(key) + 1);
  }

  private async publishLifecycle(
    state: PlaybackLifecycle,
    input: PlaybackLifecycleInput,
  ) {
    try {
      return await this.onPlaybackLifecycle?.(state, input);
    } catch {
      if (state === "queued") throw new Error("Playback route could not be persisted");
      return undefined;
    }
  }

  private rememberTargetKey(callId: string, key: string) {
    const keys = this.targetKeys.get(callId) ?? new Set<string>();
    keys.add(key);
    this.targetKeys.set(callId, keys);
  }
}

interface PlaybackConsumersReady {
  resolve: (ready: boolean) => void;
  reject: (error: unknown) => void;
}

function bindPlayback(
  input: PlaybackLifecycleInput,
  binding: CallPlaybackBinding | void,
): PlaybackStartedInput {
  return {
    ...input,
    sourceLegId: binding?.sourceLegId ?? `${input.callId}:${input.speakerRole}`,
    targetLegId: binding?.targetLegId ?? `${input.callId}:${input.targetSpeakerRole}`,
  };
}

function oppositeSpeakerRole(role: CallAudioSpeakerRole): CallAudioSpeakerRole {
  return role === "host" ? "guest" : "host";
}

function targetRouteKey(callId: string, role: CallAudioSpeakerRole) {
  return `${callId}:route:${role}`;
}

function targetQueueKey(callId: string, targetLegId: string) {
  return `${callId}:target:${targetLegId}`;
}
