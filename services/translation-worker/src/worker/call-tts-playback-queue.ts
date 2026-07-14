import type { CallRoomTranslationLanguage } from "@translation/contracts";
import { KeyedAsyncQueue } from "./keyed-async-queue.js";
import type {
  CallAudioSpeakerRole,
  CallPlaybackBinding,
  CallTtsAudioSink,
  SynthesizedSpeech,
} from "./types.js";

export interface PlaybackInput {
  callId: string;
  segmentId: string;
  speakerRole: CallAudioSpeakerRole;
  targetLanguage: CallRoomTranslationLanguage;
  translatedText: string;
  speech: SynthesizedSpeech;
}

export interface PlaybackLifecycleInput extends PlaybackInput {
  targetSpeakerRole: CallAudioSpeakerRole;
  playbackId: string;
  generation: number;
  sourceLegId?: string;
  targetLegId?: string;
  playbackReason?: PlaybackInterruptReason;
}

export interface PlaybackStartedInput extends PlaybackLifecycleInput {
  sourceLegId: string;
  targetLegId: string;
}

export type PlaybackInterruptReason =
  | "barge_in"
  | "session_end"
  | "superseded"
  | "failure";

export type PlaybackLifecycle =
  | "queued"
  | "started"
  | "interrupted"
  | "ended"
  | "failed";

interface ActivePlayback {
  input: PlaybackStartedInput;
  controller: AbortController;
}

export interface PlaybackInterruptionResult {
  supported: boolean;
  interrupted: boolean;
  cleared: boolean;
  playback?: PlaybackStartedInput;
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
    if (this.sinks.length === 0 || !input.speech.audio) return;
    const targetSpeakerRole = oppositeSpeakerRole(input.speakerRole);
    const routeKey = targetRouteKey(input.callId, targetSpeakerRole);
    const routeEpoch = this.routeEpoch(routeKey);
    void this.routeQueue.enqueue(routeKey, async () => {
      if (this.routeEpoch(routeKey) !== routeEpoch) return;
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
          await this.publishLifecycle("interrupted", {
            ...routed,
            playbackReason: "barge_in",
          });
          return;
        }
        await this.play(routed);
      });
    }).catch(() => undefined);
  }

  supportsInterruption() {
    return this.sinks.length > 0 && this.sinks.every((sink) =>
      sink.capabilities?.bidirectionalMedia === true &&
      sink.capabilities.clearPlayback === true &&
      Boolean(sink.interrupt)
    );
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

  private async play(input: PlaybackStartedInput) {
    const key = targetQueueKey(input.callId, input.targetLegId);
    const controller = new AbortController();
    this.active.set(key, { input, controller });
    this.onPlaybackStarted?.(input);
    await this.publishLifecycle("started", input);
    let failed = false;
    let queuedOnly = false;
    for (const sink of this.sinks) {
      try {
        const result = await sink.play({
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
        });
        queuedOnly ||= result?.status === "queued";
      } catch {
        if (!controller.signal.aborted) failed = true;
      }
    }
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
