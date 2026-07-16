import type {
  EnterpriseMemberRole,
  EnterpriseMemberStatus,
  EnterpriseScope,
  EnterpriseTenantJobStatus,
  EnterpriseTenantJobType,
  EnterpriseTenantStatus,
} from "@translation/contracts";

export interface EnterpriseTenantRecord {
  id: string;
  name: string;
  status: EnterpriseTenantStatus;
  homeRegion: string;
  cellId?: string;
  planCode: string;
  trialEndsAt?: string;
  billingCustomerRef?: string;
  dataRetentionDays: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseMemberRecord {
  id: string;
  tenantId: string;
  userId: string;
  role: EnterpriseMemberRole;
  status: EnterpriseMemberStatus;
  joinedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseTenantJobRecord {
  id: string;
  tenantId: string;
  actorUserId: string;
  type: EnterpriseTenantJobType;
  idempotencyKey: string;
  requestHash: string;
  status: EnterpriseTenantJobStatus;
  attempts: number;
  errorCode?: string;
  leaseExpiresAt?: string;
  nextAttemptAt?: string;
  scopeSnapshot?: EnterpriseTenantLifecycleSnapshot;
  receiptRef?: string;
  receiptHash?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseTenantLifecycleSnapshot {
  requestedAt: string;
  actor: {
    userId: string;
    role: Extract<EnterpriseMemberRole, "owner" | "admin">;
    scopes: EnterpriseScope[];
  };
  tenant: Omit<EnterpriseTenantRecord, "billingCustomerRef">;
  members: EnterpriseMemberRecord[];
  tenantJobs: Array<Pick<
    EnterpriseTenantJobRecord,
    | "id"
    | "tenantId"
    | "actorUserId"
    | "type"
    | "status"
    | "attempts"
    | "errorCode"
    | "receiptRef"
    | "receiptHash"
    | "completedAt"
    | "createdAt"
    | "updatedAt"
  >>;
}
