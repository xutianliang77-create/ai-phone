import { checkPstnInternalMediaLoopReadiness } from "./pstn_internal_media_loop_readiness.mjs";
import { checkPstnProviderMediaEventReadiness } from "./pstn_provider_media_event_readiness.mjs";
import { checkPstnProviderStatusEventReadiness } from "./pstn_provider_status_event_readiness.mjs";

export async function appendPstnBridgeReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "pstn_bridge_release_ready", true, { skipped: true });
    return;
  }
  if (!context.baseUrl) {
    context.record(context.checks, "pstn_bridge_service_identity", false, {
      reason: "missing PSTN_BRIDGE_BASE_URL",
    });
    context.issues.push("PSTN_BRIDGE_BASE_URL is required for PSTN Bridge release readiness.");
    context.actions.push("Start @translation/pstn-bridge with real provider config and set PSTN_BRIDGE_BASE_URL.");
    return;
  }
  const common = {
    checks: context.checks,
    issues: context.issues,
    actions: context.actions,
    fetchFn: context.fetchFn,
    timeoutMs: context.timeoutMs,
  };
  await context.checkServiceIdentity({
    ...common,
    name: "pstn_bridge_service_identity",
    url: `${context.baseUrl}/health`,
    expectedService: "pstn-bridge",
    action: "Start @translation/pstn-bridge on PSTN_BRIDGE_BASE_URL.",
  });
  await context.checkReleaseEndpoint({
    ...common,
    name: "pstn_bridge_release_ready",
    url: `${context.baseUrl}/health/release-ready`,
    missingRouteAction: "Restart @translation/pstn-bridge from the current workspace; /health/release-ready is missing.",
  });
}

export async function appendPstnProviderMediaEventReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "pstn_provider_media_event_readiness", true, { skipped: true });
    return;
  }
  const checkFn = context.checkFn ?? checkPstnProviderMediaEventReadiness;
  const result = await checkFn({ root: context.root, timeoutMs: context.timeoutMs });
  const ready = result.status === "ready";
  context.record(context.checks, "pstn_provider_media_event_readiness", ready, {
    status: result.status,
    frameSinkCount: result.frameSinkCount,
    acceptedFrameId: result.acceptedFrameId,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("pstn_provider_media_event_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

export async function appendPstnProviderStatusEventReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "pstn_provider_status_event_readiness", true, { skipped: true });
    return;
  }
  const checkFn = context.checkFn ?? checkPstnProviderStatusEventReadiness;
  const result = await checkFn({ root: context.root, timeoutMs: context.timeoutMs });
  const ready = result.status === "ready";
  context.record(context.checks, "pstn_provider_status_event_readiness", ready, {
    status: result.status,
    callId: result.callId,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("pstn_provider_status_event_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

export async function appendPstnInternalMediaLoopReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "pstn_internal_media_loop_readiness", true, { skipped: true });
    return;
  }
  const checkFn = context.checkFn ?? checkPstnInternalMediaLoopReadiness;
  const result = await checkFn({ root: context.root, timeoutMs: context.timeoutMs });
  const ready = result.status === "ready";
  context.record(context.checks, "pstn_internal_media_loop_readiness", ready, {
    status: result.status,
    asrFrameCount: result.asrFrameCount,
    eventBatchCount: result.eventBatchCount,
    upstreamAudioCount: result.upstreamAudioCount,
    mediaWriteCount: result.mediaWriteCount,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("pstn_internal_media_loop_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

export async function appendPstnProviderEventReadiness(context) {
  const common = {
    root: context.root,
    timeoutMs: context.timeoutMs,
    checks: context.checks,
    issues: context.issues,
    actions: context.actions,
    record: context.record,
    normalizeIssues: context.normalizeIssues,
  };
  await appendPstnProviderMediaEventReadiness({
    ...common,
    enabled: context.mediaEnabled,
    checkFn: context.mediaCheckFn,
  });
  await appendPstnProviderStatusEventReadiness({
    ...common,
    enabled: context.statusEnabled,
    checkFn: context.statusCheckFn,
  });
  await appendPstnInternalMediaLoopReadiness({
    ...common,
    enabled: context.internalLoopEnabled,
    checkFn: context.internalLoopCheckFn,
  });
}
