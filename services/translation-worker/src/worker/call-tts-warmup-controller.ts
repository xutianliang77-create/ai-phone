import type { CallCaptionPipeline } from "./call-caption-pipeline.js";
import { callWorkerStatusEvent as statusEvent } from
  "./call-worker-runtime-events.js";
import type { CallRoomEventSink } from "./types.js";

export class CallTtsWarmupController {
  private readonly warmups = new Map<string, {
    controller: AbortController;
    task: Promise<void>;
  }>();

  constructor(
    private readonly captionPipeline: CallCaptionPipeline,
    private readonly eventSink: CallRoomEventSink,
    private readonly nowMs: () => number,
  ) {}

  start(callId: string) {
    const controller = new AbortController();
    const runtime = {
      controller,
      task: Promise.resolve() as Promise<void>,
    };
    runtime.task = Promise.resolve()
      .then(() => this.captionPipeline.warmupTts(callId, controller.signal))
      .then(() => undefined)
      .catch(async () => {
        if (controller.signal.aborted) return;
        await this.eventSink.publish(callId, [
          statusEvent(
            "tts-warmup-failed",
            "TTS 预热未通过，首句可能降级为冷启动",
            this.nowMs(),
            { stage: "tts", retryable: true },
          ),
        ]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.warmups.get(callId) === runtime) {
          this.warmups.delete(callId);
        }
      });
    this.warmups.set(callId, runtime);
  }

  async stop(callId: string) {
    const runtime = this.warmups.get(callId);
    if (!runtime) return;
    this.warmups.delete(callId);
    runtime.controller.abort(new Error("Call ended during TTS warmup"));
    await runtime.task;
  }
}
