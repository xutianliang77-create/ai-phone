import {
  isEnterpriseMemberRole,
  type EnterpriseMemberRole,
} from "@translation/contracts";

const enterpriseTenantContextBrand = Symbol("EnterpriseTenantContext");

export interface EnterpriseTenantContext {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly actorRole?: EnterpriseMemberRole;
  readonly traceId: string;
  readonly [enterpriseTenantContextBrand]: true;
}

export function createEnterpriseTenantContext(input: {
  tenantId: string;
  actorUserId: string;
  actorRole?: EnterpriseMemberRole;
  traceId: string;
}): EnterpriseTenantContext {
  const tenantId = requiredContextValue("tenantId", input.tenantId, 128);
  const actorUserId = requiredContextValue(
    "actorUserId",
    input.actorUserId,
    128,
  );
  const traceId = requiredContextValue("traceId", input.traceId, 160);
  if (input.actorRole !== undefined && !isEnterpriseMemberRole(input.actorRole)) {
    throw new Error("Invalid enterprise tenant context actorRole");
  }
  return Object.freeze({
    tenantId,
    actorUserId,
    actorRole: input.actorRole,
    traceId,
    [enterpriseTenantContextBrand]: true as const,
  });
}

function requiredContextValue(
  field: string,
  value: string,
  maxLength: number,
) {
  const cleaned = typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
  if (!cleaned) throw new Error(`Invalid enterprise tenant context ${field}`);
  return cleaned;
}
