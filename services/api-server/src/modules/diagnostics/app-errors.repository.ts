import { randomUUID } from "node:crypto";

import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type {
  AppErrorReportFilter,
  AppErrorReportRecord,
  AppErrorReportSummary,
} from "./app-error-record.js";

export const maxStoredReports = 200;

export function createAppErrorReport(
  report: Omit<AppErrorReportRecord, "id" | "receivedAt">,
) {
  const record: AppErrorReportRecord = {
    ...report,
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
  };
  const store = getStoreSnapshot();
  store.appErrorReports = [record, ...store.appErrorReports].slice(0, maxStoredReports);
  persistStoreSnapshot();
  return record;
}

export function listAppErrorReports(filter: AppErrorReportFilter = {}) {
  const reports = getStoreSnapshot().appErrorReports.filter((record) =>
    matchesFilter(record, filter),
  );
  return reports.slice(0, normalizeLimit(filter.limit));
}

export function findAppErrorReport(eventId: string) {
  return getStoreSnapshot().appErrorReports.find((record) => record.id === eventId);
}

export function summarizeAppErrorReports(
  filter: Omit<AppErrorReportFilter, "limit"> = {},
): AppErrorReportSummary {
  const reports = getStoreSnapshot().appErrorReports.filter((record) =>
    matchesFilter(record, filter),
  );
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

function matchesFilter(record: AppErrorReportRecord, filter: AppErrorReportFilter) {
  if (filter.eventType && record.eventType !== filter.eventType) return false;
  if (filter.platform && record.platform !== filter.platform) return false;
  if (filter.fatal !== undefined && record.fatal !== filter.fatal) return false;
  if (filter.since && Date.parse(record.receivedAt) < Date.parse(filter.since)) {
    return false;
  }
  return true;
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
