import { checkDiagnosticsAlertingReadinessOnLocalStack } from "./diagnostics_alerting_local_stack.mjs";

export async function appendDiagnosticsAlertingLocalSmoke(context) {
  if (!context.enabled) {
    context.record(context.checks, "diagnostics_alerting_local_smoke", true, { skipped: true });
    return;
  }
  const checkFn = context.checkFn ?? checkDiagnosticsAlertingReadinessOnLocalStack;
  const result = await checkFn({ root: context.root, timeoutMs: context.timeoutMs });
  const ready = result.status === "ready";
  context.record(context.checks, "diagnostics_alerting_local_smoke", ready, {
    status: result.status,
    webhookCallCount: result.webhookCallCount,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("diagnostics_alerting_local_smoke is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}
