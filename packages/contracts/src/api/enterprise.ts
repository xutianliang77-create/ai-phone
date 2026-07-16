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

export type EnterpriseTenantStatus =
  | "active"
  | "suspended"
  | "deletion_requested"
  | "deleted";

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
