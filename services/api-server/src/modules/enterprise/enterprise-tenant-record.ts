import type {
  EnterpriseMemberRole,
  EnterpriseMemberStatus,
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
