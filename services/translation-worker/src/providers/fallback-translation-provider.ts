import type {
  CallTranslationProvider,
  TranslationStreamEvent,
} from "../worker/types.js";
import { StickyProviderFallbackController } from
  "../worker/provider-fallback-controller.js";

type TranslationInput = Parameters<CallTranslationProvider["translate"]>[0];

export class FallbackTranslationProvider implements CallTranslationProvider {
  private readonly initializedPrimary = new Set<string>();
  private readonly initializedFallback = new Set<string>();

  constructor(private readonly options: {
    primary: CallTranslationProvider;
    fallback: CallTranslationProvider;
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

  async translate(input: TranslationInput) {
    if (this.options.controller.route(input.callId) === "fallback") {
      await this.ensureCall(input.callId, "fallback");
      return this.options.fallback.translate(input);
    }
    try {
      await this.ensureCall(input.callId, "primary");
      const result = await this.options.primary.translate(input);
      await this.options.controller.primarySucceeded(input.callId);
      return result;
    } catch (error) {
      const switched = await this.options.controller.primaryFailed(
        input.callId,
        error,
        input.signal,
      );
      if (!switched) throw error;
      await this.ensureCall(input.callId, "fallback");
      return this.options.fallback.translate(input);
    }
  }

  async *translateStream(input: TranslationInput): AsyncIterable<TranslationStreamEvent> {
    if (this.options.controller.route(input.callId) === "fallback") {
      await this.ensureCall(input.callId, "fallback");
      yield* streamFrom(this.options.fallback, input);
      return;
    }
    let emitted = false;
    let completed = false;
    try {
      await this.ensureCall(input.callId, "primary");
      for await (const event of streamFrom(this.options.primary, input)) {
        emitted = true;
        if (event.type === "final") completed = true;
        yield event;
      }
      await this.options.controller.primarySucceeded(input.callId);
      return;
    } catch (error) {
      if (completed) {
        await this.options.controller.primarySucceeded(input.callId);
        return;
      }
      const switched = await this.options.controller.primaryFailed(
        input.callId,
        error,
        input.signal,
      );
      if (!switched) throw error;
    }
    await this.ensureCall(input.callId, "fallback");
    if (emitted) yield { type: "restart" };
    yield* streamFrom(this.options.fallback, input);
  }

  async closeCall(callId: string) {
    this.initializedPrimary.delete(callId);
    this.initializedFallback.delete(callId);
    this.options.controller.close(callId);
    const results = await Promise.allSettled([
      this.options.primary.closeCall?.(callId),
      this.options.fallback.closeCall?.(callId),
    ]);
    throwFirstRejection(results);
  }

  private async ensureCall(callId: string, route: "primary" | "fallback") {
    const initialized = route === "primary"
      ? this.initializedPrimary
      : this.initializedFallback;
    if (initialized.has(callId)) return;
    const provider = route === "primary"
      ? this.options.primary
      : this.options.fallback;
    await provider.createCall?.(callId);
    initialized.add(callId);
  }
}

async function* streamFrom(
  provider: CallTranslationProvider,
  input: TranslationInput,
): AsyncIterable<TranslationStreamEvent> {
  if (provider.translateStream) {
    yield* provider.translateStream(input);
    return;
  }
  yield { type: "final", text: await provider.translate(input) };
}

function throwFirstRejection(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
}
