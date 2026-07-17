import {
  participantTrackSpeaker,
  type CallRoomSubmittedEvent,
} from "@translation/contracts";
import type { CallTtsPlaybackQueue } from "./call-tts-playback-queue.js";
import type {
  CallAudioSpeakerRole,
  CallDuplexConfig,
  CallRoomEventSink,
  CallVadDecision,
} from "./types.js";

interface SpeechState {
  lastSequence: number;
  lastFrameEndMs: number;
  consecutiveSpeechMs: number;
  minimumProbability: number;
  lastBargeInMs: number;
  degradedReason?: string;
}

export class CallInterruptionController {
  private readonly states = new Map<string, SpeechState>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly options: {
    config: CallDuplexConfig;
    playbackQueue: CallTtsPlaybackQueue;
    eventSink: CallRoomEventSink;
    nowMs: () => number;
    onBargeIn?: (
      callId: string,
      targetSpeakerRole: CallAudioSpeakerRole,
    ) => void;
  }) {}

  observe(decision: CallVadDecision) {
    if (!this.options.config.enabled) return;
    const key = stateKey(decision.callId, decision.speakerRole);
    const state = this.states.get(key) ?? initialState();
    if (decision.sequence <= state.lastSequence) return;

    const frameEndMs = decision.timestampMs + decision.durationMs;
    if (decision.timestampMs > state.lastFrameEndMs + maxFrameGapMs(decision)) {
      resetSpeech(state);
    }
    state.lastSequence = decision.sequence;
    state.lastFrameEndMs = frameEndMs;
    this.states.set(key, state);

    const unavailableReason = vadUnavailableReason(decision, this.options.config);
    if (unavailableReason) {
      resetSpeech(state);
      this.publishModeChange(decision, state, "pipeline.degraded", unavailableReason);
      return;
    }
    if (state.degradedReason && this.options.playbackQueue.supportsInterruption()) {
      this.publishModeChange(decision, state, "pipeline.restored");
    }
    if (!decision.voiced || (decision.probability ?? 0) < this.options.config.minProbability) {
      resetSpeech(state);
      return;
    }

    state.consecutiveSpeechMs += decision.durationMs;
    state.minimumProbability = Math.min(
      state.minimumProbability,
      decision.probability ?? 0,
    );
    const now = this.options.nowMs();
    if (state.consecutiveSpeechMs < this.options.config.minSpeechMs ||
      now - state.lastBargeInMs < this.options.config.cooldownMs ||
      this.inFlight.has(key)) return;

    this.options.onBargeIn?.(decision.callId, decision.speakerRole);
    this.inFlight.add(key);
    void this.interrupt(decision, state).finally(() => {
      this.inFlight.delete(key);
    });
  }

  notifyVadUnavailable(callId: string, speakerRole: CallAudioSpeakerRole) {
    if (!this.options.config.enabled) return;
    const key = stateKey(callId, speakerRole);
    const state = this.states.get(key) ?? initialState();
    this.states.set(key, state);
    resetSpeech(state);
    this.publishModeChange({
      callId,
      speakerRole,
      sequence: state.lastSequence + 1,
      timestampMs: this.options.nowMs(),
      durationMs: 0,
      voiced: false,
      provider: "unavailable",
      fallback: true,
      preRollMs: 0,
    }, state, "pipeline.degraded", "vad_unavailable");
  }

  clear(callId: string) {
    const prefix = `${callId}:`;
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) this.states.delete(key);
    }
    for (const key of this.inFlight) {
      if (key.startsWith(prefix)) this.inFlight.delete(key);
    }
  }

  private async interrupt(decision: CallVadDecision, state: SpeechState) {
    const detectedAt = this.options.nowMs();
    const result = await this.options.playbackQueue.interruptSpeaker({
      callId: decision.callId,
      targetSpeakerRole: decision.speakerRole,
      reason: "barge_in",
    });
    if (!result.playback) return;
    if (!result.supported || !result.cleared) {
      this.publishModeChange(
        decision,
        state,
        "pipeline.degraded",
        result.supported ? "playback_clear_failed" : "playback_clear_unsupported",
      );
      return;
    }

    state.lastBargeInMs = detectedAt;
    const speechDurationMs = state.consecutiveSpeechMs;
    const probability = state.minimumProbability;
    resetSpeech(state);
    const stopLatencyMs = Math.max(0, this.options.nowMs() - detectedAt);
    const eventBase = {
      segmentId: result.playback.segmentId,
      sourceLegId: result.playback.sourceLegId,
      targetLegId: result.playback.targetLegId,
      playbackId: result.playback.playbackId,
      generation: result.playback.generation,
      speakerRole: decision.speakerRole,
      speaker: participantTrackSpeaker(decision.speakerRole),
      sourceLanguage: result.playback.targetLanguage,
      targetLanguage: result.playback.targetLanguage === "zh" ? "en" as const : "zh" as const,
      text: "检测到用户抢话",
      playbackReason: "barge_in",
      duplexMode: "full_duplex" as const,
      vadProvider: decision.provider,
      vadProbability: probability,
      speechDurationMs,
      preRollMs: decision.preRollMs,
    };
    await this.publish(decision.callId, [
      { ...eventBase, type: "barge_in.detected", timestampMs: detectedAt },
      {
        ...eventBase,
        type: "barge_in.confirmed",
        stopLatencyMs,
        timestampMs: this.options.nowMs(),
      },
    ]);
  }

  private publishModeChange(
    decision: CallVadDecision,
    state: SpeechState,
    type: "pipeline.degraded" | "pipeline.restored",
    reason?: string,
  ) {
    if (type === "pipeline.degraded") {
      if (state.degradedReason === reason) return;
      state.degradedReason = reason;
    } else {
      if (!state.degradedReason) return;
      state.degradedReason = undefined;
    }
    void this.publish(decision.callId, [{
      type,
      segmentId: `${type}-${decision.speakerRole}-${decision.sequence}`,
      speakerRole: decision.speakerRole,
      speaker: participantTrackSpeaker(decision.speakerRole),
      sourceLanguage: "zh",
      targetLanguage: "en",
      text: type === "pipeline.degraded"
        ? "全双工抢话已降级为半双工"
        : "全双工抢话已恢复",
      duplexMode: type === "pipeline.degraded" ? "half_duplex" : "full_duplex",
      ...(reason ? { degradationReason: reason } : {}),
      vadProvider: decision.provider,
      ...(decision.probability === undefined
        ? {}
        : { vadProbability: decision.probability }),
      preRollMs: decision.preRollMs,
      timestampMs: this.options.nowMs(),
    }]);
  }

  private async publish(callId: string, events: CallRoomSubmittedEvent[]) {
    try {
      await this.options.eventSink.publish(callId, events);
    } catch {
      // Media interruption must not wait for observability delivery.
    }
  }
}

function initialState(): SpeechState {
  return {
    lastSequence: -1,
    lastFrameEndMs: 0,
    consecutiveSpeechMs: 0,
    minimumProbability: 1,
    lastBargeInMs: Number.NEGATIVE_INFINITY,
  };
}

function resetSpeech(state: SpeechState) {
  state.consecutiveSpeechMs = 0;
  state.minimumProbability = 1;
}

function stateKey(callId: string, role: CallAudioSpeakerRole) {
  return `${callId}:${role}`;
}

function maxFrameGapMs(decision: CallVadDecision) {
  return Math.max(400, decision.durationMs * 2);
}

function vadUnavailableReason(
  decision: CallVadDecision,
  config: CallDuplexConfig,
) {
  if (decision.fallback || decision.provider !== "marblenet") return "vad_fallback";
  if (decision.probability === undefined) return "vad_probability_unavailable";
  if (decision.preRollMs < config.preRollMs) return "preroll_insufficient";
  return null;
}
