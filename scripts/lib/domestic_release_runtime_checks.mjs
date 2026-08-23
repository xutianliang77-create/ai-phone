import { checkCallLinkLiveKitWorkerReadiness } from "./call_link_livekit_worker_readiness.mjs";
import { checkLiveKitSelfHostConfig } from "./livekit_selfhost_config.mjs";
import { checkLiveKitRoomMediaReadiness } from "./livekit_room_media_readiness.mjs";
import { checkMobileAppReleaseReadiness } from "./mobile_app_release_readiness.mjs";

export function checkMobileAppRelease(context) {
  const result = (context.checkFn ?? checkMobileAppReleaseReadiness)(
    context.root ?? process.cwd(),
  );
  const ready = result.status === "ready";
  context.record(context.checks, "mobile_app_release_readiness", ready, {
    status: result.status,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("mobile_app_release_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

export function appendLiveKitSelfHostReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "livekit_selfhost_config", true, { skipped: true });
    return;
  }
  const result = (context.checkFn ?? checkLiveKitSelfHostConfig)({
    root: context.root,
    envFile: context.envFile,
    requireSip: context.requireSip,
  });
  const ready = result.status === "ready";
  context.record(context.checks, "livekit_selfhost_config", ready, {
    status: result.status,
    envFile: result.envFile,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("livekit_selfhost_config is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

export async function appendCallLinkWorkerReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "call_link_livekit_worker_readiness", true, {
      skipped: true,
    });
    return;
  }
  const checkFn = context.checkFn ?? checkCallLinkLiveKitWorkerReadiness;
  const result = await checkFn({
    apiBaseUrl: context.apiBaseUrl,
    internalApiSecret: context.internalApiSecret,
    diagnosticsAdminToken: context.diagnosticsAdminToken,
    timeoutMs: context.timeoutMs,
    fetchFn: context.fetchFn,
    loadRtcNode: context.loadRtcNode,
  });
  const ready = result.status === "ready";
  context.record(context.checks, "call_link_livekit_worker_readiness", ready, {
    status: result.status,
    callId: result.callId,
    roomName: result.roomName,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("call_link_livekit_worker_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

export async function appendLiveKitRoomMediaReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "livekit_room_media_readiness", true, {
      skipped: true,
    });
    return;
  }
  const checkFn = context.checkFn ?? checkLiveKitRoomMediaReadiness;
  const result = await checkFn({
    apiBaseUrl: context.apiBaseUrl,
    internalApiSecret: context.internalApiSecret,
    timeoutMs: context.timeoutMs,
    fetchFn: context.fetchFn,
    loadRtcNode: context.loadRtcNode,
  });
  const ready = result.status === "ready";
  context.record(context.checks, "livekit_room_media_readiness", ready, {
    status: result.status,
    callId: result.callId,
    roomName: result.roomName,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("livekit_room_media_readiness is not ready.");
    context.issues.push(...context.normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}
