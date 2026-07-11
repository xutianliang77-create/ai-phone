import { checkAgentCallWorkerReadiness } from "./agent_call_worker_readiness.mjs";

export async function appendAgentCallWorkerReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "agent_call_worker_readiness", true, { skipped: true });
    return;
  }
  const checkFn = context.checkFn ?? checkAgentCallWorkerReadiness;
  const result = await checkFn({ root: context.root, timeoutMs: context.timeoutMs });
  const ready = result.status === "ready";
  context.record(context.checks, "agent_call_worker_readiness", ready, {
    status: result.status,
    draftId: result.draftId,
    callId: result.callId,
    providerCallId: result.providerCallId,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("agent_call_worker_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}
