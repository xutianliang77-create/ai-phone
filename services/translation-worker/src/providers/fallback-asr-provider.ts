import type {
  CallAsrProvider,
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallVadDecisionSink,
} from "../worker/types.js";
import { StickyProviderFallbackController } from
  "../worker/provider-fallback-controller.js";

export class FallbackAsrProvider implements CallAsrProvider {
  private readonly initializedPrimary = new Set<string>();
  private readonly initializedFallback = new Set<string>();
  private vadDecisionSink: CallVadDecisionSink | null = null;

  constructor(private readonly options: {
    primary: CallAsrProvider;
    fallback: CallAsrProvider;
    controller: StickyProviderFallbackController;
  }) {}

  async createCall(callId: string) {
    const route = this.options.controller.open(callId);
    if (route === "fallback") {
      await this.ensureCall(callId, route);
      return;
    }
    try {
      await this.ensureCall(callId, "primary");
    } catch (error) {
      if (!await this.options.controller.primaryFailed(callId, error)) throw error;
      await this.ensureCall(callId, "fallback");
    }
  }

  setVadDecisionSink(sink: CallVadDecisionSink | null) {
    this.vadDecisionSink = sink;
    this.options.primary.setVadDecisionSink?.(sink);
    this.options.fallback.setVadDecisionSink?.(sink);
  }

  async transcribe(frame: CallAudioFrame) {
    return this.execute(frame.sessionId, () =>
      this.options.primary.transcribe(frame), () =>
      this.options.fallback.transcribe(frame));
  }

  async flush(callId: string, speakerRole: CallAudioSpeakerRole) {
    return this.execute(callId, () =>
      this.options.primary.flush(callId, speakerRole), () =>
      this.options.fallback.flush(callId, speakerRole));
  }

  async closeCall(callId: string) {
    this.initializedPrimary.delete(callId);
    this.initializedFallback.delete(callId);
    this.options.controller.close(callId);
    const results = await Promise.allSettled([
      this.options.primary.closeCall(callId),
      this.options.fallback.closeCall(callId),
    ]);
    throwFirstRejection(results);
  }

  private async execute<T>(
    callId: string,
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
  ) {
    if (this.options.controller.route(callId) === "fallback") {
      await this.ensureCall(callId, "fallback");
      return fallback();
    }
    try {
      await this.ensureCall(callId, "primary");
      const result = await primary();
      await this.options.controller.primarySucceeded(callId);
      return result;
    } catch (error) {
      if (!await this.options.controller.primaryFailed(callId, error)) throw error;
      await this.ensureCall(callId, "fallback");
      return fallback();
    }
  }

  private async ensureCall(callId: string, route: "primary" | "fallback") {
    const initialized = route === "primary"
      ? this.initializedPrimary
      : this.initializedFallback;
    if (initialized.has(callId)) return;
    const provider = route === "primary"
      ? this.options.primary
      : this.options.fallback;
    await provider.createCall(callId);
    initialized.add(callId);
    provider.setVadDecisionSink?.(this.vadDecisionSink);
  }
}

function throwFirstRejection(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
}
