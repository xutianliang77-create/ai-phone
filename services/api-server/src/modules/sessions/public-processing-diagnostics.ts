import type { SessionRecord } from "./session-record.js";
import {hasPublicProviderReconciliation} from "./public-provider-reconciliation.js";

const components = ["asr", "translation", "tts"] as const;
type Component = typeof components[number];
type Ownership = "device" | "public" | "disabled" | "unknown";

export interface PublicProcessingDiagnostics {
  sessionId: string;
  status: string;
  ownership: Array<{
    component: Component;
    execution: string;
    owner: Ownership;
    publicAttemptCount: number;
    confirmedAttemptCount: number;
    uncertainAttemptCount: number;
    providerIds: string[];
    modelIds: string[];
  }>;
  totals: {
    componentSlots: number;
    deviceComponentCount: number;
    publicComponentCount: number;
    disabledComponentCount: number;
    publicAttemptCount: number;
    confirmedPublicAttemptCount: number;
    uncertainPublicAttemptCount: number;
    unexpectedPublicAttemptCount: number;
    duplicateConfirmedComputeCount: number;
  };
  providerUsage: {
    reported: Record<string, number>;
    reconciliation?: {
      providerId: string;
      evidenceScope: string;
      providerUsageCount: number;
      providerUsageSeconds: number;
    };
    reconciliations?: Array<{providerId:string;evidenceScope:string;providerUsageCount:number;providerUsageSeconds:number}>;
    reconciliationComplete?: boolean;
    moneyCostStatus: "unknown" | "not_applicable";
  };
  finalization: {
    serverConsumedSeconds: number;
    finalizationPersisted: boolean;
    originalRuntimeUncertain: boolean;
  };
}

/** Read-only accounting diagnostic. It never exposes transcript text, model
 * credentials, raw provider IDs, or turns provider usage into a money value. */
export function publicProcessingDiagnostics(session: SessionRecord): PublicProcessingDiagnostics {
  const attempts = session.publicModelAttempts ?? [];
  const summary=session.publicAttemptStorageVersion===2?session.publicAttemptSummary:undefined;
  const ownership = components.map((component) => {
    const execution = executionFor(session, component);
    const owner = ownerFor(execution);
    const matching = attempts.filter((attempt) => attempt.event.component === component);
    const counted=summary?.components[component];
    return {
      component,
      execution,
      owner,
      publicAttemptCount: counted?.total??matching.length,
      confirmedAttemptCount: counted?.confirmed??matching.filter((attempt) => attempt.event.state === "confirmed").length,
      uncertainAttemptCount: counted?.uncertain??matching.filter((attempt) => attempt.event.state === "uncertain").length,
      providerIds: counted?.providerIds??unique(matching.map((attempt) => attempt.event.providerId)),
      modelIds: counted?.modelIds??unique(matching.map((attempt) => attempt.event.modelId)),
    };
  });
  const publicAttempts = attempts.filter((attempt) => ownerFor(executionFor(session, attempt.event.component as Component)) === "public");
  const unexpected = attempts.filter((attempt) => ownerFor(executionFor(session, attempt.event.component as Component)) !== "public");
  const reconciliation = session.publicProviderReconciliation;
  return {
    sessionId: session.id,
    status: session.status,
    ownership,
    totals: {
      componentSlots: ownership.filter((item) => item.owner !== "disabled").length,
      deviceComponentCount: ownership.filter((item) => item.owner === "device").length,
      publicComponentCount: ownership.filter((item) => item.owner === "public").length,
      disabledComponentCount: ownership.filter((item) => item.owner === "disabled").length,
      publicAttemptCount: summary?.total??publicAttempts.length,
      confirmedPublicAttemptCount: summary?.states.confirmed??publicAttempts.filter((attempt) => attempt.event.state === "confirmed").length,
      uncertainPublicAttemptCount: summary?.states.uncertain??publicAttempts.filter((attempt) => attempt.event.state === "uncertain").length,
      unexpectedPublicAttemptCount: unexpected.length,
      duplicateConfirmedComputeCount: summary?0:duplicateConfirmed(publicAttempts),
    },
    providerUsage: {
      reported: summary?structuredClone(summary.reportedUsage):aggregateUsage(publicAttempts),
      ...(reconciliation ? {
        reconciliation: {
          providerId: reconciliation.providerId,
          evidenceScope: reconciliation.evidenceScope,
          providerUsageCount: reconciliation.providerUsageCount,
          providerUsageSeconds: reconciliation.providerUsageSeconds,
        },
      } : {}),
      ...(session.publicProviderReconciliations ? {
        reconciliations: session.publicProviderReconciliations.map(record => ({providerId:record.providerId,
          evidenceScope:record.evidenceScope,providerUsageCount:record.providerUsageCount,providerUsageSeconds:record.providerUsageSeconds})),
        reconciliationComplete: hasPublicProviderReconciliation(session),
      } : {}),
      moneyCostStatus: (summary?.total??publicAttempts.length)>0 ? "unknown" : "not_applicable",
    },
    finalization: {
      serverConsumedSeconds: session.consumedSeconds,
      finalizationPersisted: Boolean(session.publicFinalization),
      originalRuntimeUncertain: Boolean(session.publicRuntime?.uncertain),
    },
  };
}

function executionFor(session: SessionRecord, component: Component) {
  const execution = (session.processingAuthorization?.executionPlan as Record<string, { execution?: unknown }> | undefined)?.[component]?.execution;
  return typeof execution === "string" ? execution : "unknown";
}

function ownerFor(execution: string): Ownership {
  if (execution === "public") return "public";
  if (execution === "disabled") return "disabled";
  if (["device", "local", "on_device"].includes(execution)) return "device";
  return "unknown";
}

function aggregateUsage(attempts: Array<{ event: { metadata?: { usage?: Record<string, unknown> } } }>) {
  const totals: Record<string, number> = {};
  for (const attempt of attempts) {
    for (const [key, value] of Object.entries(attempt.event.metadata?.usage ?? {})) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        totals[key] = (totals[key] ?? 0) + value;
      }
    }
  }
  return totals;
}

function duplicateConfirmed(attempts: Array<{ event: { component: string; segmentId: string; revision: number; state: string } }>) {
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.event.state !== "confirmed") continue;
    const key = `${attempt.event.component}\u0000${attempt.event.segmentId}\u0000${attempt.event.revision}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}
