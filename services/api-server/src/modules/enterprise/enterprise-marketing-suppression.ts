import { createHash } from "node:crypto";
import type {
  EnterpriseMarketingSuppressionDto,
  EnterpriseMarketingSuppressionScope,
  EnterpriseMarketingSuppressionSource,
} from "@translation/contracts";

export interface EnterpriseMarketingSuppressionRecord {
  id: string;
  tenantId: string;
  leadId: string;
  phoneHint: string;
  scope: EnterpriseMarketingSuppressionScope;
  source: EnterpriseMarketingSuppressionSource;
  reason: string;
  sourceReference: string;
  createdBy: string;
  createdAt: string;
  cancelledTaskCount: number;
  version: number;
}

export function marketingSuppressionDto(
  record: EnterpriseMarketingSuppressionRecord,
): EnterpriseMarketingSuppressionDto {
  const { tenantId: _tenantId, ...dto } = record;
  return dto;
}

export function marketingSuppressionCreationHash(input: {
  actorUserId: string;
  campaignId: string;
  leadId: string;
  scope: "tenant";
  source: Exclude<EnterpriseMarketingSuppressionSource, "global_registry">;
  reason: string;
  sourceReference: string;
}) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(
    value as Record<string, unknown>,
  ).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
