import {
  enterpriseScopes,
  type EnterpriseMemberRole,
  type EnterpriseScope,
} from "@translation/contracts";

const roleScopes = {
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
  member: [
    "tenant:read",
    "meeting:read",
  ],
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

export function enterpriseScopesForRole(role: EnterpriseMemberRole) {
  return roleScopes[role] as readonly EnterpriseScope[];
}

export function hasEnterpriseScope(
  role: EnterpriseMemberRole,
  scope: EnterpriseScope,
) {
  return enterpriseScopesForRole(role).includes(scope);
}
