import { LiveKitIngressProviderAdapter } from "./livekit-ingress-provider-adapter.js";
import { SrtLiveKitIngressProviderAdapter } from
  "./srt-livekit-ingress-provider-adapter.js";
import { applyIngressProviderJob } from "./livekit-ingress-reconciliation.js";
import { getLiveKitIngressConfig } from "./livekit-ingress-readiness.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import {
  listRecoverableExternalMediaSources,
  updateExternalMediaSource,
} from "./ingress.repository.js";

export async function recoverExternalMediaSources() {
  const config = getLiveKitIngressConfig();
  if (!config.ok) return { inspectedCount: 0, recoveredCount: 0, failedCount: 0 };
  const sources = listRecoverableExternalMediaSources();
  const results = await Promise.allSettled(sources.map(async (source) => {
    if (source.inputType === "srt" && !config.config.srtBridgeConfigured) {
      throw new Error("SRT bridge cleanup is unavailable");
    }
    if (source.inputType === "srt") {
      if (!source.externalBridgeId) {
        await cleanupOrphanedLiveKitIngress(
          source,
          new LiveKitIngressProviderAdapter(config.config),
          "srt_bridge_id_missing",
          config.config.requestTimeoutSeconds,
        );
        return;
      }
      const provider = new SrtLiveKitIngressProviderAdapter(
        config.config as typeof config.config & {
          srtBridgeBaseUrl: string;
          srtBridgeApiKey: string;
        },
      );
      const bridgeResult = await provider.getBridge(source.externalBridgeId);
      if (!bridgeResult.ok) {
        if (bridgeResult.errorClass === "not_found") {
          await cleanupBrokenSrtIngress(
            source,
            provider,
            "srt_bridge_not_found",
            config.config.requestTimeoutSeconds,
          );
          return;
        }
        throw new Error(`SRT bridge reconciliation failed: ${bridgeResult.errorClass}`);
      }
      if (["failed", "stopped"].includes(bridgeResult.job.status)) {
        await cleanupBrokenSrtIngress(
          source,
          provider,
          bridgeResult.job.errorClass ?? "srt_bridge_stopped",
          config.config.requestTimeoutSeconds,
        );
        return;
      }
      const result = await provider.get(source.externalIngressId!);
      if (!result.ok) throw new Error(`Ingress reconciliation failed: ${result.errorClass}`);
      if (!result.result) {
        updateExternalMediaSource({
          sourceId: source.id,
          status: "failed",
          errorClass: "ingress_not_found",
        });
        return;
      }
      applyIngressProviderJob(source.id, result.result);
      return;
    }
    const provider = new LiveKitIngressProviderAdapter(config.config);
    const result = await provider.get(source.externalIngressId!);
    if (!result.ok) throw new Error(`Ingress reconciliation failed: ${result.errorClass}`);
    if (!result.result) {
      updateExternalMediaSource({
        sourceId: source.id,
        status: "failed",
        errorClass: "ingress_not_found",
      });
      return;
    }
    applyIngressProviderJob(source.id, result.result);
  }));
  const recoveredCount = results.filter((result) => result.status === "fulfilled").length;
  return {
    inspectedCount: sources.length,
    recoveredCount,
    failedCount: sources.length - recoveredCount,
  };
}

async function cleanupBrokenSrtIngress(
  source: Parameters<typeof cleanupOperation>[0],
  provider: SrtLiveKitIngressProviderAdapter,
  errorClass: string,
  timeoutSeconds: number,
) {
  return cleanupOperation(source, errorClass, async (operation) => provider.delete({
    ...operation,
    payload: {
      ingressId: source.externalIngressId!,
      bridgeId: source.externalBridgeId!,
    },
  }), timeoutSeconds);
}

async function cleanupOrphanedLiveKitIngress(
  source: Parameters<typeof cleanupOperation>[0],
  provider: LiveKitIngressProviderAdapter,
  errorClass: string,
  timeoutSeconds: number,
) {
  return cleanupOperation(source, errorClass, async (operation) => provider.delete({
    ...operation,
    payload: { ingressId: source.externalIngressId! },
  }), timeoutSeconds);
}

async function cleanupOperation(
  source: ReturnType<typeof listRecoverableExternalMediaSources>[number],
  errorClass: string,
  execute: (operation: {
    operationId: string;
    sessionId: string;
    expectedVersion: number;
    idempotencyKey: string;
    deadlineAt: string;
  }) => ReturnType<LiveKitIngressProviderAdapter["delete"]>,
  timeoutSeconds: number,
) {
  const operation = beginProviderOperation({
    sessionId: source.sessionId,
    provider: "livekit_ingress",
    operationType: "ingress_delete",
    operationKey: source.id,
    idempotencyKey: `ingress-recovery-delete:${source.id}`,
    requestHash: source.externalIngressId!,
  }).operation;
  const result = await execute({
    operationId: operation.id,
    sessionId: source.sessionId,
    expectedVersion: operation.version,
    idempotencyKey: operation.idempotencyKey,
    deadlineAt: new Date(Date.now() + timeoutSeconds * 1_000).toISOString(),
  });
  if (result.ok) {
    updateProviderOperation({ operationId: operation.id, status: "succeeded" });
    updateExternalMediaSource({ sourceId: source.id, status: "failed", errorClass });
    return;
  }
  if (result.errorClass === "not_found") {
    updateProviderOperation({ operationId: operation.id, status: "succeeded" });
    updateExternalMediaSource({ sourceId: source.id, status: "failed", errorClass });
    return;
  }
  updateProviderOperation({
    operationId: operation.id,
    status: result.reconciliationRequired ? "unknown" : "failed",
    errorClass: result.errorClass,
  });
  throw new Error(`Ingress cleanup failed: ${result.errorClass}`);
}

export function startIngressRecovery(input: {
  intervalSeconds: number;
  onResult?: (result: Awaited<ReturnType<typeof recoverExternalMediaSources>>) => void;
  onError?: (error: unknown) => void;
}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void recoverExternalMediaSources().then(input.onResult).catch(input.onError)
      .finally(() => {
        running = false;
      });
  }, input.intervalSeconds * 1_000);
  timer.unref();
  return () => clearInterval(timer);
}
