import { checkTtsProviderReadiness } from "./tts_provider_readiness.mjs";

export async function appendTtsProviderReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "tts_provider_readiness", true, { skipped: true });
    return;
  }
  const checkFn = context.checkFn ?? checkTtsProviderReadiness;
  const result = await checkFn({
    endpoint: context.endpoint,
    apiKey: context.apiKey,
    provider: context.provider,
    model: context.model,
    timeoutMs: context.timeoutMs,
    maxFirstAudioMs: context.maxFirstAudioMs,
    fetchFn: context.fetchFn,
  });
  const ready = result.status === "ready";
  context.record(context.checks, "tts_provider_readiness", ready, {
    status: result.status,
    endpoint: result.endpoint,
    provider: result.provider,
    model: result.model,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("tts_provider_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}
