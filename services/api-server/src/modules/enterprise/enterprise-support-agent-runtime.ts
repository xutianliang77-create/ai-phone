import type {
  EnterpriseSupportAgentDispatchResponse,
  EnterpriseSupportAgentRecentTurn,
  EnterpriseSupportAgentTurnOutput,
  EnterpriseSupportAgentWorkerSnapshot,
  EnterpriseSupportRagResponse,
} from "@translation/contracts";
import type { EnterpriseSupportAgentRunRecord,
  EnterpriseSupportAgentTurnRecord } from "./enterprise-support-agent.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };
type WorkerInput = {
  ticket: string; workerCellId: string; workerId: string; traceId: string;
  now?: Date;
};

export interface EnterpriseSupportAgentRepositoryRuntime {
  prepareSupportAgent?(input: {
    context: EnterpriseTenantContext; sessionId: string; queueId: string;
    locale: string; countryCode: string; productCode: string; now: string;
  }): Promise<
    | { status: "ready"; dispatch: EnterpriseSupportAgentDispatchResponse }
    | { status: "not_ready"; reasonCode: string }
    | StorageRequired
  >;
  acceptSupportAgentWorker?(input: WorkerInput & { leaseSeconds: number }): Promise<
    | { status: "accepted"; snapshot: EnterpriseSupportAgentWorkerSnapshot }
    | { status: string }
  >;
  heartbeatSupportAgentWorker?(input: WorkerInput & { leaseSeconds: number }):
    Promise<{ status: string }>;
  refreshSupportAgentWorker?(input: WorkerInput & {
    leaseSeconds: number; ticketTtlSeconds: number;
  }): Promise<{ status: string; ticket?: string; expiresAt?: string }>;
  prepareSupportAgentTurn?(input: WorkerInput & {
    inputTurnId: string; idempotencyKey: string; customerText: string;
    recentTurns: EnterpriseSupportAgentRecentTurn[];
  }): Promise<
    | { status: "ready"; run: EnterpriseSupportAgentRunRecord;
        turn: EnterpriseSupportAgentTurnRecord;
        resolution: EnterpriseSupportRagResponse;
        context: EnterpriseSupportAgentRecentTurn[]; replayed: boolean }
    | { status: string }
  >;
  completeSupportAgentTurn?(input: WorkerInput & {
    runId: string; turnId: string; output: EnterpriseSupportAgentTurnOutput;
    status: "generated" | "degraded" | "handoff";
    providerFingerprint?: string; failureCode?: string;
    customerText: string; context: EnterpriseSupportAgentRecentTurn[];
  }): Promise<
    | { status: "updated"; run: EnterpriseSupportAgentRunRecord;
        turn: EnterpriseSupportAgentTurnRecord }
    | { status: string }
  >;
  authorizeSupportAgentTts?(input: WorkerInput & {
    runId: string; turnId: string;
  }): Promise<
    | { status: "authorized"; generation: number; spokenText: string }
    | { status: string }
  >;
  deliverSupportAgentTurn?(input: WorkerInput & {
    runId: string; turnId: string;
  }): Promise<{ status: string }>;
  finalizeSupportAgentWorker?(input: WorkerInput & {
    outcome: "completed" | "failed";
  }): Promise<{ status: string }>;
}
