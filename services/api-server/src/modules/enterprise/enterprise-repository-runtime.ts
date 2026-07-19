import type {
  EnterpriseAuditResult,
  EnterpriseMemberRole,
  EnterpriseMemberStatus,
  EnterpriseTenantJobType,
  EnterpriseSessionTraceReportResponse,
} from "@translation/contracts";
import type {
  EnterpriseAuditAppendInput,
  EnterpriseAuditPosition,
} from "./enterprise-audit.repository.js";
import {
  appendEnterpriseAuditEvent,
  listEnterpriseAuditEvents,
} from "./enterprise-audit.repository.js";
import type {
  TenantLifecycleExecutionResult,
} from "./enterprise-tenant-lifecycle-executor.js";
import {
  beginEnterpriseTenantCreation,
  beginEnterpriseTenantRetry,
  finalizeEnterpriseTenantProvision,
  findEnterpriseTenantJob,
  startEnterpriseTenantLifecycleJob,
} from "./enterprise-tenant-lifecycle.repository.js";
import {
  claimEnterpriseTenantLifecycleJob,
  finalizeEnterpriseTenantLifecycleJob,
  pendingEnterpriseTenantLifecycleJobRefs,
} from "./enterprise-tenant-job.repository.js";
import type {
  EnterpriseTenantContext,
} from "./enterprise-tenant-context.js";
import type {
  EnterpriseMemberRecord,
  EnterpriseTenantJobRecord,
  EnterpriseTenantRecord,
} from "./enterprise-tenant-record.js";
import {
  addEnterpriseMember,
  listEnterpriseMemberships,
  listEnterpriseMembers,
  resolveEnterpriseContext,
  updateEnterpriseMember,
} from "./enterprise-tenants.repository.js";
import type {
  EnterpriseCommunicationPolicyVersion,
} from "./enterprise-communication-policy.js";
import type {
  ConfigureEnterpriseUsageBudgetInput,
  ConfigureEnterpriseUsageBudgetResult,
  EnterpriseUsageBudgetRecord,
} from "./enterprise-usage-budget.js";
import type {
  ChangeEnterpriseSubscriptionInput,
  ChangeEnterpriseSubscriptionResult,
  EnterpriseEntitlementState,
} from "./enterprise-billing-entitlement.js";
import type {
  AdjustEnterpriseUsageInput,
  AdjustEnterpriseUsageResult,
  EnterpriseUsagePeriodAggregateRecord,
  RebuildEnterpriseUsagePeriodInput,
  RebuildEnterpriseUsagePeriodResult,
  RecordEnterpriseUsageEventInput,
  RecordEnterpriseUsageEventResult,
} from "./enterprise-usage-accounting.js";
import type {
  EnterpriseKnowledgeRepositoryRuntime,
} from "./enterprise-knowledge-runtime.js";
import type {
  EnterpriseTerminologyRepositoryRuntime,
} from "./enterprise-terminology-runtime.js";
import type { EnterpriseAuditExportRuntime } from "./enterprise-audit-export-runtime.js";
import type { EnterpriseMeetingRepositoryRuntime } from "./enterprise-meeting-runtime.js";
import type { EnterpriseSupportRepositoryRuntime } from "./enterprise-support-runtime.js";
import type { EnterpriseSupportAgentRepositoryRuntime } from
  "./enterprise-support-agent-runtime.js";
import type { EnterpriseSupportToolRepositoryRuntime } from
  "./enterprise-support-tool-runtime.js";

export type EnterpriseContextResult =
  | { status: "resolved"; tenant: EnterpriseTenantRecord; member: EnterpriseMemberRecord }
  | { status: "access_denied" }
  | { status: "selection_required" };

export type EnterpriseLifecycleResult = {
  status: string;
  tenant?: EnterpriseTenantRecord;
  member?: EnterpriseMemberRecord;
  job?: EnterpriseTenantJobRecord;
  execution?: {
    job: {
      id: string;
      tenantId: string;
      type: "tenant.export" | "tenant.delete";
      attempt: number;
    };
    snapshot: NonNullable<EnterpriseTenantJobRecord["scopeSnapshot"]>;
  };
};

export interface EnterpriseRepositoryRuntime
  extends EnterpriseKnowledgeRepositoryRuntime,
    EnterpriseTerminologyRepositoryRuntime,
    EnterpriseAuditExportRuntime,
    EnterpriseMeetingRepositoryRuntime,
    EnterpriseSupportRepositoryRuntime,
    EnterpriseSupportAgentRepositoryRuntime,
    EnterpriseSupportToolRepositoryRuntime {
  readonly driver: "legacy" | "postgres";
  resolveContext(input: {
    userId: string;
    selectedTenantId?: string;
    traceId: string;
  }): Promise<EnterpriseContextResult>;
  listMemberships(input: {
    userId: string;
    traceId: string;
  }): Promise<Array<{ tenant: EnterpriseTenantRecord; member: EnterpriseMemberRecord }>>;
  listMembers(context: EnterpriseTenantContext): Promise<EnterpriseMemberRecord[]>;
  addMember(input: {
    context: EnterpriseTenantContext;
    userId: string;
    role: EnterpriseMemberRole;
  }): Promise<
    | { status: "created"; member: EnterpriseMemberRecord }
    | { status: "account_not_found" }
    | { status: "already_exists"; member?: EnterpriseMemberRecord }
  >;
  updateMember(input: {
    context: EnterpriseTenantContext;
    memberId: string;
    role?: EnterpriseMemberRole;
    status?: EnterpriseMemberStatus;
  }): Promise<
    | { status: "updated"; member: EnterpriseMemberRecord }
    | { status: "not_found" }
    | { status: "owner_protected"; member?: EnterpriseMemberRecord }
    | { status: "conflict" }
  >;
  appendAudit(input: EnterpriseAuditAppendInput): Promise<void>;
  listAudit(input: {
    context: EnterpriseTenantContext;
    limit: number;
    action?: string;
    resourceType?: string;
    result?: EnterpriseAuditResult;
    before?: EnterpriseAuditPosition;
  }): Promise<{
    events: import("./enterprise-tenant-record.js").EnterpriseAuditEventRecord[];
    nextPosition?: EnterpriseAuditPosition;
  }>;
  publishCommunicationPolicy?(input: {
    context: EnterpriseTenantContext;
    policy: Omit<EnterpriseCommunicationPolicyVersion, "tenantId"> & {
      publishedAt: string;
    };
  }): Promise<
    | { status: "created"; id: string }
    | { status: "version_conflict" }
    | { status: "storage_required" }
  >;
  configureUsageBudget?(input: {
    context: EnterpriseTenantContext;
    budget: ConfigureEnterpriseUsageBudgetInput;
  }): Promise<ConfigureEnterpriseUsageBudgetResult | { status: "storage_required" }>;
  listUsageBudgets?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; budgets: EnterpriseUsageBudgetRecord[] }
    | { status: "storage_required" }
  >;
  getBillingEntitlements?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; state: EnterpriseEntitlementState }
    | { status: "not_found" }
    | { status: "storage_required" }
  >;
  changeSubscription?(input: {
    context: EnterpriseTenantContext;
    change: ChangeEnterpriseSubscriptionInput;
  }): Promise<ChangeEnterpriseSubscriptionResult | { status: "storage_required" }>;
  recordUsageEvent?(input: {
    context: EnterpriseTenantContext;
    event: RecordEnterpriseUsageEventInput;
  }): Promise<RecordEnterpriseUsageEventResult | { status: "storage_required" }>;
  adjustUsage?(input: {
    context: EnterpriseTenantContext;
    adjustment: AdjustEnterpriseUsageInput;
  }): Promise<AdjustEnterpriseUsageResult | { status: "storage_required" }>;
  rebuildUsagePeriod?(input: {
    context: EnterpriseTenantContext;
    period: RebuildEnterpriseUsagePeriodInput;
  }): Promise<RebuildEnterpriseUsagePeriodResult | { status: "storage_required" }>;
  listUsagePeriodAggregates?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; aggregates: EnterpriseUsagePeriodAggregateRecord[] }
    | { status: "storage_required" }
  >;
  getSessionTraceReport?(input: {
    context: EnterpriseTenantContext;
    sessionId: string;
  }): Promise<
    | { status: "ready"; report: EnterpriseSessionTraceReportResponse }
    | { status: "not_found" }
    | { status: "storage_required" }
  >;
  beginTenantCreation(input: {
    ownerUserId: string;
    name: string;
    homeRegion: string;
    idempotencyKey: string;
    traceId: string;
  }): Promise<EnterpriseLifecycleResult>;
  beginTenantRetry(input: {
    tenantId: string;
    actorUserId: string;
    idempotencyKey: string;
    traceId: string;
  }): Promise<EnterpriseLifecycleResult>;
  finalizeTenantProvision(input: {
    tenantId: string;
    actorUserId: string;
    jobId: string;
    result: import("./enterprise-tenant-provisioner.js").TenantProvisionResult;
  }): Promise<EnterpriseLifecycleResult>;
  startTenantLifecycleJob(input: {
    tenantId: string;
    actorUserId: string;
    type: Exclude<EnterpriseTenantJobType, "tenant.provision">;
    idempotencyKey: string;
    traceId: string;
  }): Promise<EnterpriseLifecycleResult>;
  findTenantJob(input: {
    jobId: string;
    userId: string;
    traceId: string;
  }): Promise<EnterpriseTenantJobRecord | null>;
  claimTenantLifecycleJob(input: {
    context: EnterpriseTenantContext;
    jobId: string;
    now: Date;
    force: boolean;
  }): Promise<EnterpriseLifecycleResult>;
  finalizeTenantLifecycleJob(input: {
    context: EnterpriseTenantContext;
    jobId: string;
    attempt: number;
    result: TenantLifecycleExecutionResult;
    now: Date;
  }): Promise<EnterpriseLifecycleResult>;
  pendingTenantLifecycleJobRefs(
    now?: Date,
  ): Promise<Array<{ jobId: string; tenantId: string; actorUserId: string }>>;
  close(): Promise<void>;
}

export const legacyEnterpriseRepositoryRuntime: EnterpriseRepositoryRuntime = {
  driver: "legacy",
  async resolveContext(input) {
    return resolveEnterpriseContext(input.userId, input.selectedTenantId);
  },
  async listMemberships(input) {
    return listEnterpriseMemberships(input.userId);
  },
  async listMembers(context) {
    return listEnterpriseMembers(context);
  },
  async addMember(input) {
    return addEnterpriseMember(input);
  },
  async updateMember(input) {
    return updateEnterpriseMember(input);
  },
  async appendAudit(input) {
    appendEnterpriseAuditEvent(input);
  },
  async listAudit(input) {
    return listEnterpriseAuditEvents(input);
  },
  async publishCommunicationPolicy() {
    return { status: "storage_required" };
  },
  async configureUsageBudget() {
    return { status: "storage_required" };
  },
  async listUsageBudgets() {
    return { status: "storage_required" };
  },
  async getBillingEntitlements() {
    return { status: "storage_required" };
  },
  async changeSubscription() {
    return { status: "storage_required" };
  },
  async recordUsageEvent() {
    return { status: "storage_required" };
  },
  async adjustUsage() {
    return { status: "storage_required" };
  },
  async rebuildUsagePeriod() {
    return { status: "storage_required" };
  },
  async listUsagePeriodAggregates() {
    return { status: "storage_required" };
  },
  async getSessionTraceReport() {
    return { status: "storage_required" };
  },
  async createAuditExport() {
    return { status: "storage_required" };
  },
  async listAuditExports() {
    return { status: "storage_required" };
  },
  async findAuditExport() {
    return { status: "storage_required" };
  },
  async beginTenantCreation(input) {
    return beginEnterpriseTenantCreation(input);
  },
  async beginTenantRetry(input) {
    return beginEnterpriseTenantRetry(input);
  },
  async finalizeTenantProvision(input) {
    return finalizeEnterpriseTenantProvision(input.jobId, input.result);
  },
  async startTenantLifecycleJob(input) {
    return startEnterpriseTenantLifecycleJob(input);
  },
  async findTenantJob(input) {
    return findEnterpriseTenantJob(input.jobId, input.userId);
  },
  async claimTenantLifecycleJob(input) {
    return claimEnterpriseTenantLifecycleJob(input);
  },
  async finalizeTenantLifecycleJob(input) {
    return finalizeEnterpriseTenantLifecycleJob(input);
  },
  async pendingTenantLifecycleJobRefs(now) {
    return pendingEnterpriseTenantLifecycleJobRefs(now);
  },
  async close() {},
};
