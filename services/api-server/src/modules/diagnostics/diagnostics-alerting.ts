import { summarizeAppErrorReports } from "./app-errors.repository.js";
import {
  diagnosticsAlertWebhookConfigIssues,
  diagnosticsAlertWebhookStatus,
} from "./diagnostics-alert-webhook.js";
import { diagnosticsAdminStatus } from "./diagnostics-auth.js";

export function getDiagnosticsAlertState(now = new Date()) {
  const windowMinutes = positiveInt(process.env.DIAGNOSTICS_ALERT_WINDOW_MINUTES, 15);
  const fatalThreshold = positiveInt(process.env.DIAGNOSTICS_FATAL_ALERT_THRESHOLD, 1);
  const since = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const summary = summarizeAppErrorReports({ since });
  const critical = summary.fatal >= fatalThreshold;
  return {
    status: critical ? "critical" : "ok",
    windowMinutes,
    fatalThreshold,
    since,
    fatal: summary.fatal,
    total: summary.total,
    latestReceivedAt: summary.latestReceivedAt,
    byEventType: summary.byEventType,
    byPlatform: summary.byPlatform,
  };
}

export function getDiagnosticsDeploymentReadiness() {
  const alertState = getDiagnosticsAlertState();
  const issues = [
    ...configIssues(),
    ...(alertState.status === "critical"
      ? [`diagnostics fatal errors ${alertState.fatal} >= ${alertState.fatalThreshold}`]
      : []),
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    adminQuery: diagnosticsAdminStatus(),
    onCall: process.env.DIAGNOSTICS_ONCALL_CONTACT ? "configured" : "configuration_required",
    webhook: diagnosticsAlertWebhookStatus(),
    alertState,
    issues,
  };
}

function configIssues() {
  const issues: string[] = [];
  if (!process.env.DIAGNOSTICS_ADMIN_TOKEN) {
    issues.push("diagnostics missing DIAGNOSTICS_ADMIN_TOKEN");
  }
  if (!process.env.DIAGNOSTICS_ONCALL_CONTACT) {
    issues.push("diagnostics missing DIAGNOSTICS_ONCALL_CONTACT");
  }
  if (!isPositiveInt(process.env.DIAGNOSTICS_ALERT_WINDOW_MINUTES)) {
    issues.push("diagnostics invalid DIAGNOSTICS_ALERT_WINDOW_MINUTES");
  }
  if (!isPositiveInt(process.env.DIAGNOSTICS_FATAL_ALERT_THRESHOLD)) {
    issues.push("diagnostics invalid DIAGNOSTICS_FATAL_ALERT_THRESHOLD");
  }
  issues.push(...diagnosticsAlertWebhookConfigIssues());
  return issues;
}

function positiveInt(value: string | undefined, fallback: number) {
  if (value === undefined || value.length === 0) return fallback;
  return isPositiveInt(value) ? Number(value) : fallback;
}

function isPositiveInt(value: string | undefined) {
  if (value === undefined || value.length === 0) return true;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}
