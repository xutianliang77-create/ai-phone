export const enterpriseMemberRoles = [
  "owner",
  "admin",
  "marketing_manager",
  "marketing_member",
  "support_manager",
  "support_agent",
  "meeting_host",
  "member",
  "auditor",
] as const;

export type EnterpriseMemberRole = typeof enterpriseMemberRoles[number];

export const enterpriseMemberStatuses = [
  "invited",
  "active",
  "suspended",
] as const;

export type EnterpriseMemberStatus = typeof enterpriseMemberStatuses[number];

export const enterpriseScopes = [
  "tenant:read",
  "tenant:write",
  "member:read",
  "member:write",
  "knowledge:read",
  "knowledge:publish",
  "campaign:read",
  "campaign:write",
  "campaign:approve",
  "support:read",
  "support:manage",
  "support:takeover",
  "meeting:read",
  "meeting:write",
  "screen_share:stop",
  "audit:read",
  "audit:export",
] as const;

export type EnterpriseScope = typeof enterpriseScopes[number];

export const enterpriseRoleScopes = {
  owner: enterpriseScopes,
  admin: enterpriseScopes,
  marketing_manager: [
    "tenant:read",
    "knowledge:read",
    "knowledge:publish",
    "campaign:read",
    "campaign:write",
    "campaign:approve",
  ],
  marketing_member: [
    "tenant:read",
    "knowledge:read",
    "campaign:read",
    "campaign:write",
  ],
  support_manager: [
    "tenant:read",
    "knowledge:read",
    "knowledge:publish",
    "support:read",
    "support:manage",
    "support:takeover",
  ],
  support_agent: [
    "tenant:read",
    "knowledge:read",
    "support:read",
    "support:takeover",
  ],
  meeting_host: [
    "tenant:read",
    "meeting:read",
    "meeting:write",
    "screen_share:stop",
  ],
  member: ["tenant:read", "meeting:read"],
  auditor: [
    "tenant:read",
    "member:read",
    "knowledge:read",
    "campaign:read",
    "support:read",
    "meeting:read",
    "audit:read",
    "audit:export",
  ],
} as const satisfies Record<EnterpriseMemberRole, readonly EnterpriseScope[]>;

export type EnterpriseTenantStatus =
  | "provisioning"
  | "provisioning_failed"
  | "active"
  | "suspended"
  | "deletion_requested"
  | "deleted";

export type EnterpriseTenantJobType =
  | "tenant.provision"
  | "tenant.suspend"
  | "tenant.export"
  | "tenant.delete";

export type EnterpriseTenantJobStatus = "processing" | "completed" | "failed";

export interface EnterpriseTenantDto {
  id: string;
  name: string;
  status: EnterpriseTenantStatus;
  homeRegion: string;
  cellId?: string;
  planCode: string;
  trialEndsAt?: string;
  dataRetentionDays: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseMemberDto {
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

export interface EnterpriseTenantJobDto {
  id: string;
  tenantId: string;
  actorUserId: string;
  type: EnterpriseTenantJobType;
  status: EnterpriseTenantJobStatus;
  attempts: number;
  errorCode?: string;
  receiptRef?: string;
  receiptHash?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnterpriseTenantJobResponse {
  job: EnterpriseTenantJobDto;
}

export interface EnterpriseTenantLifecycleResponse {
  tenant: EnterpriseTenantDto;
  member: EnterpriseMemberDto;
  job: EnterpriseTenantJobDto;
}

export interface EnterpriseTenantRouteDocument {
  tenantId: string;
  homeRegion: string;
  cellId: string;
  apiBaseUrl: string;
  rtcUrl: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export type EnterpriseProviderCapability =
  | "pstn.outbound"
  | "crm.sync"
  | "calendar.meetings"
  | "channel.messaging";

export type EnterpriseProviderCapabilityStatus =
  | "not_configured"
  | "checking"
  | "ready"
  | "degraded"
  | "not_ready";

export interface EnterpriseProviderCapabilityDocument {
  provider: string;
  capability: EnterpriseProviderCapability;
  status: EnterpriseProviderCapabilityStatus;
  region: string;
  checkedAt: string;
  expiresAt: string;
  reasonCode?: string;
  features: Record<string, boolean>;
  fingerprint: string;
}

export interface EnterpriseProviderCapabilitiesResponse {
  capabilities: EnterpriseProviderCapabilityDocument[];
}

export interface EnterpriseMembershipDto {
  tenant: EnterpriseTenantDto;
  member: EnterpriseMemberDto;
}

export interface EnterpriseContextResponse extends EnterpriseMembershipDto {
  scopes: readonly EnterpriseScope[];
}

export interface EnterpriseTenantListResponse {
  tenants: EnterpriseMembershipDto[];
}

export interface CreateEnterpriseTenantRequest {
  name: string;
  homeRegion: string;
}

export interface CreateEnterpriseMemberRequest {
  tenantId?: string;
  userId: string;
  role: EnterpriseMemberRole;
}

export interface UpdateEnterpriseMemberRequest {
  tenantId?: string;
  role?: EnterpriseMemberRole;
  status?: EnterpriseMemberStatus;
}

export function isEnterpriseMemberRole(
  value: unknown,
): value is EnterpriseMemberRole {
  return typeof value === "string" &&
    enterpriseMemberRoles.includes(value as EnterpriseMemberRole);
}

export function isEnterpriseMemberStatus(
  value: unknown,
): value is EnterpriseMemberStatus {
  return typeof value === "string" &&
    enterpriseMemberStatuses.includes(value as EnterpriseMemberStatus);
}

export function isEnterpriseScope(value: unknown): value is EnterpriseScope {
  return typeof value === "string" &&
    enterpriseScopes.includes(value as EnterpriseScope);
}
