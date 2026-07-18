export const enterpriseUsageCategories = [
  "meeting_audio_seconds",
  "screen_share_seconds",
  "screen_ocr_frames",
  "support_ai_seconds",
  "support_human_seconds",
  "marketing_call_seconds",
  "pstn_seconds",
  "asr_seconds",
  "tts_characters",
  "llm_input_tokens",
  "llm_output_tokens",
] as const;

export type EnterpriseUsageCategory =
  (typeof enterpriseUsageCategories)[number];

export const enterpriseUsageUnits = [
  "seconds",
  "frames",
  "characters",
  "tokens",
] as const;

export type EnterpriseUsageUnit = (typeof enterpriseUsageUnits)[number];

export interface EnterpriseUsageBudgetDto {
  id: string;
  tenantId: string;
  category: EnterpriseUsageCategory;
  unit: EnterpriseUsageUnit;
  limitAmount: number;
  alertThresholdPercent: number;
  status: "active" | "paused";
  periodStart: string;
  periodEnd: string;
  version: number;
  updatedAt: string;
}

export interface ConfigureEnterpriseUsageBudgetRequest {
  tenantId?: string;
  unit: EnterpriseUsageUnit;
  limitAmount: number;
  alertThresholdPercent: number;
  periodStart: string;
  periodEnd: string;
  expectedVersion?: number;
}

export interface EnterpriseUsageBudgetsResponse {
  budgets: EnterpriseUsageBudgetDto[];
}

export function isEnterpriseUsageCategory(
  value: unknown,
): value is EnterpriseUsageCategory {
  return typeof value === "string" && enterpriseUsageCategories.includes(
    value as EnterpriseUsageCategory,
  );
}

export function isEnterpriseUsageUnit(
  value: unknown,
): value is EnterpriseUsageUnit {
  return typeof value === "string" && enterpriseUsageUnits.includes(
    value as EnterpriseUsageUnit,
  );
}
