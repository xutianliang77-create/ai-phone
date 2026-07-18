import { randomUUID } from "node:crypto";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type {
  AppErrorReportFilter,
  AppErrorReportRecord,
  AppErrorReportSummary,
} from "./app-error-record.js";
import * as legacy from "./app-errors.repository.js";

export const maxStoredReports = legacy.maxStoredReports;

export async function createAppErrorReport(
  report: Omit<AppErrorReportRecord, "id" | "receivedAt">,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.createAppErrorReport(report);
  const record: AppErrorReportRecord = {
    ...report,
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
  };
  const requestHash = repositoryRequestHash(record);
  const result = await withPostgresRepositoryFence(
    { aggregateType: "diagnostics_stream", aggregateId: "app-errors" },
    (fence) => runtime.postgres.productRecords.mutate<AppErrorReportRecord>({
      namespace: "appErrorReports",
      recordKey: record.id,
      commandId: repositoryCommandId({ aggregateId: "app-errors",
        operation: "diagnostics-create", version: 1, requestHash }),
      commandType: "diagnostics.app_error.create",
      requestHash,
      eventType: "diagnostics.app_error.received",
      fence,
      mutate: (current) => current ?? record,
    }),
  );
  return result.record ?? record;
}

export async function listAppErrorReports(filter: AppErrorReportFilter = {}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.listAppErrorReports(filter);
  const reports = await runtime.postgres.productRecords.query<AppErrorReportRecord>({
    namespace: "appErrorReports",
    kind: filter.eventType,
    status: filter.platform,
    flag: filter.fatal,
    since: filter.since,
    limit: Math.min(maxStoredReports, Math.max(filter.limit ?? 20, 100)),
  });
  return reports.slice(0, normalizeLimit(filter.limit));
}

export async function findAppErrorReport(eventId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.productRecords.find<AppErrorReportRecord>("appErrorReports", eventId)
    : legacy.findAppErrorReport(eventId);
}

export async function summarizeAppErrorReports(
  filter: Omit<AppErrorReportFilter, "limit"> = {},
): Promise<AppErrorReportSummary> {
  const reports = await listAppErrorReports({ ...filter, limit: maxStoredReports });
  const fatal = reports.filter((record) => record.fatal).length;
  return {
    status: fatal > 0 ? "attention_required" : "ok",
    total: reports.length,
    fatal,
    nonFatal: reports.length - fatal,
    byEventType: countBy(reports, (record) => record.eventType),
    byPlatform: countBy(reports, (record) => record.platform ?? "unknown"),
    byAppVersion: countBy(reports, (record) => record.appVersion ?? "unknown"),
    latestReceivedAt: reports[0]?.receivedAt,
    since: filter.since,
    retainedLimit: maxStoredReports,
  };
}

function normalizeLimit(limit: number | undefined) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

function countBy(
  reports: AppErrorReportRecord[],
  keyFor: (record: AppErrorReportRecord) => string,
) {
  return reports.reduce<Record<string, number>>((counts, record) => {
    const key = keyFor(record);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
