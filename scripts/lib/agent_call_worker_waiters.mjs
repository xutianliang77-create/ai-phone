import { requestJson, sleep } from "./script_service_utils.mjs";

export async function waitForWorkerDispatch(context) {
  const deadline = Date.now() + context.config.timeoutMs;
  while (Date.now() < deadline) {
    if (context.worker?.exited) {
      throw new Error(`worker exited early; see ${context.worker.logPath}`);
    }
    const latest = (await requestJson(
      `${context.config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(context.draft.id)}`,
      { ...context, allowError: true },
    )).body?.draft;
    if (latest?.status === "in_progress") {
      return {
        final: latest,
        bridgeCall: {
          headers: { authorization: "present" },
          body: { draftId: context.draft.id, callId: context.draft.callId },
        },
      };
    }
    await sleep(250);
  }
  throw new Error(`worker did not call PSTN bridge; see ${context.config.logs.worker}`);
}

export async function waitForDraftStatus(context) {
  const deadline = Date.now() + context.config.timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = (await requestJson(
      `${context.config.apiBaseUrl}/ai-calling-agent/drafts/${encodeURIComponent(context.draftId)}`,
      context,
    )).body?.draft;
    if (latest?.status === context.expectedStatus) return latest;
    await sleep(250);
  }
  return latest;
}
