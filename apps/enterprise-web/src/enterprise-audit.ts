import type {
  EnterpriseAuditExportPurpose,
  EnterpriseAuditExportStatus,
  EnterpriseAuditResult,
  EnterpriseAuditDetailValue,
} from "@translation/contracts";

export const auditResultLabels: Record<EnterpriseAuditResult, string> = {
  accepted: "已受理",
  completed: "已完成",
  failed: "失败",
  denied: "已拒绝",
};

export const auditExportPurposeLabels: Record<EnterpriseAuditExportPurpose, string> = {
  compliance_review: "合规复核",
  security_investigation: "安全调查",
  customer_request: "客户请求",
  regulatory_request: "监管请求",
};

export const auditExportStatusLabels: Record<EnterpriseAuditExportStatus, string> = {
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
  expired: "已到期",
};

export function visibleAuditIdentifier(value: string | undefined) {
  if (!value) return "系统";
  return value.length <= 18 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function formatAuditDetail(key: string, value: EnterpriseAuditDetailValue) {
  if (/token|secret|password|authorization|idempotency|phone|url/i.test(key)) {
    return "[已脱敏]";
  }
  if (value === null) return "null";
  if (typeof value !== "string") return String(value);
  return /(?:id|hash)$/i.test(key) ? visibleAuditIdentifier(value) : value;
}

export function defaultAuditExportWindow(now = new Date()) {
  return {
    from: localDateTime(new Date(now.getTime() - 86_400_000)),
    until: localDateTime(now),
  };
}

export function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
