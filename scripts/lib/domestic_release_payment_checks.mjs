import { checkDomesticPaymentCallbacksReadiness } from "./domestic_payment_callbacks_readiness.mjs";

export async function appendDomesticPaymentCallbacksLocalSmoke(context) {
  if (!context.enabled) {
    context.record(context.checks, "domestic_payment_callbacks_local_smoke", true, { skipped: true });
    return;
  }
  const checkFn = context.checkFn ?? checkDomesticPaymentCallbacksReadiness;
  const result = await checkFn({ root: context.root, timeoutMs: context.timeoutMs });
  const ready = result.status === "ready";
  context.record(context.checks, "domestic_payment_callbacks_local_smoke", ready, {
    status: result.status,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("domestic_payment_callbacks_local_smoke is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}
