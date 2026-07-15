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
