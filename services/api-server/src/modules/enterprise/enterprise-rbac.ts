import {
  enterpriseRoleScopes,
  type EnterpriseMemberRole,
  type EnterpriseScope,
} from "@translation/contracts";

export function enterpriseScopesForRole(role: EnterpriseMemberRole) {
  return enterpriseRoleScopes[role] as readonly EnterpriseScope[];
}

export function hasEnterpriseScope(
  role: EnterpriseMemberRole,
  scope: EnterpriseScope,
) {
  return enterpriseScopesForRole(role).includes(scope);
}
