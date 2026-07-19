import type { FastifyInstance } from "fastify";

import { sendError } from "../../infrastructure/http/errors.js";
import type { AppErrorReportFilter, AppErrorReportRecord } from "./app-error-record.js";
import {
  createAppErrorReport,
  findAppErrorReport,
  listAppErrorReports,
  maxStoredReports,
  summarizeAppErrorReports,
} from "./app-errors-runtime.repository.js";
import { sanitizeAppErrorReport } from "./app-error-sanitizer.js";
import { dispatchDiagnosticsAlert } from "./diagnostics-alert-webhook.js";
import { getDiagnosticsAlertState } from "./diagnostics-alerting.js";
import { verifyDiagnosticsAdmin } from "./diagnostics-auth.js";

export async function registerDiagnosticsRoutes(app: FastifyInstance) {
  app.get("/diagnostics/app-errors", async (request, reply) => {
    const auth = verifyDiagnosticsAdmin(request.headers.authorization);
    if (!auth.ok) return sendError(reply, auth.statusCode, auth.code, auth.message);

    const reports = await listAppErrorReports(parseFilter(request.query));
    return {
      reports: reports.map(toListItem),
      retentionLimit: maxStoredReports,
    };
  });

  app.get("/diagnostics/app-errors/summary", async (request, reply) => {
    const auth = verifyDiagnosticsAdmin(request.headers.authorization);
    if (!auth.ok) return sendError(reply, auth.statusCode, auth.code, auth.message);

    return await summarizeAppErrorReports(parseFilter(request.query));
  });

  app.get("/diagnostics/app-errors/alert-state", async (request, reply) => {
    const auth = verifyDiagnosticsAdmin(request.headers.authorization);
    if (!auth.ok) return sendError(reply, auth.statusCode, auth.code, auth.message);

    return await getDiagnosticsAlertState();
  });

  app.post("/diagnostics/app-errors/alert-test", async (request, reply) => {
    const auth = verifyDiagnosticsAdmin(request.headers.authorization);
    if (!auth.ok) return sendError(reply, auth.statusCode, auth.code, auth.message);

    const result = await dispatchDiagnosticsAlert(
      buildTestAlertRecord(),
      await getDiagnosticsAlertState(),
      undefined,
      { type: "app_error_test" },
    );
    request.log.warn(
      { alertDispatch: result.status },
      "Diagnostics alert test dispatch completed",
    );
    return reply.status(result.status === "sent" ? 200 : 503).send({
      status: result.status,
      result,
    });
  });

  app.get("/diagnostics/app-errors/:eventId", async (request, reply) => {
    const auth = verifyDiagnosticsAdmin(request.headers.authorization);
    if (!auth.ok) return sendError(reply, auth.statusCode, auth.code, auth.message);

    const { eventId } = request.params as { eventId: string };
    const report = await findAppErrorReport(eventId);
    if (!report) return sendError(reply, 404, "app_error_not_found", "App error not found");
    return report;
  });

  app.post("/diagnostics/app-errors", async (request, reply) => {
    const sanitized = sanitizeAppErrorReport(request.body);
    if (!sanitized.ok) {
      return sendError(reply, 400, sanitized.code, sanitized.code);
    }
    const record = await createAppErrorReport(sanitized.report);
    request.log.warn(
      {
        eventId: record.id,
        eventType: record.eventType,
        fatal: record.fatal,
        platform: record.platform,
      },
      "App error report received",
    );
    if (record.fatal) {
      const alertState = await getDiagnosticsAlertState();
      void dispatchDiagnosticsAlert(record, alertState).then((result) => {
        request.log.warn(
          { eventId: record.id, alertDispatch: result.status },
          "Diagnostics alert dispatch completed",
        );
      });
    }
    return reply.status(202).send({ status: "accepted", eventId: record.id });
  });
}

function parseFilter(query: unknown): AppErrorReportFilter {
  const input = query && typeof query === "object"
    ? query as Record<string, unknown>
    : {};
  return {
    eventType: stringQuery(input.eventType),
    fatal: booleanQuery(input.fatal),
    platform: stringQuery(input.platform),
    since: dateQuery(input.since),
    limit: numberQuery(input.limit),
  };
}

function toListItem(record: AppErrorReportRecord) {
  return {
    id: record.id,
    eventType: record.eventType,
    message: record.message,
    fatal: record.fatal,
    platform: record.platform,
    appVersion: record.appVersion,
    buildNumber: record.buildNumber,
    regionEdition: record.regionEdition,
    dataRegion: record.dataRegion,
    occurredAt: record.occurredAt,
    receivedAt: record.receivedAt,
  };
}

function buildTestAlertRecord(): AppErrorReportRecord {
  const now = new Date().toISOString();
  return {
    id: "diagnostics-alert-test",
    eventType: "manual",
    message: "Diagnostics alert test",
    fatal: true,
    platform: "ops",
    appVersion: process.env.APP_VERSION,
    buildNumber: process.env.BUILD_NUMBER,
    regionEdition: process.env.REGION_EDITION ?? "domestic",
    dataRegion: process.env.DATA_REGION ?? "cn",
    occurredAt: now,
    receivedAt: now,
  };
}

function stringQuery(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanQuery(value: unknown) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function dateQuery(value: unknown) {
  if (typeof value !== "string") return undefined;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

function numberQuery(value: unknown) {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
