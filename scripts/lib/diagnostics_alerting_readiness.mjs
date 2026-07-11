export async function checkDiagnosticsAlertingReadiness(options = {}) {
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl ?? "http://127.0.0.1:3100");
  const checks = [];
  const issues = [];
  const actions = [];

  if (!options.diagnosticsAdminToken) {
    record(checks, "diagnostics_admin_token_present", false);
    issues.push("DIAGNOSTICS_ADMIN_TOKEN is required for diagnostics alerting readiness.");
    actions.push("Set DIAGNOSTICS_ADMIN_TOKEN and rerun diagnostics alerting readiness.");
    return result({ apiBaseUrl, checks, issues, actions });
  }
  record(checks, "diagnostics_admin_token_present", true);

  await checkHealth({ ...options, apiBaseUrl, checks, issues, actions });
  await sendAlertTest({ ...options, apiBaseUrl, checks, issues, actions });
  return result({ apiBaseUrl, checks, issues, actions });
}

async function checkHealth(context) {
  try {
    const response = await requestJson(context, `${context.apiBaseUrl}/health`);
    const diagnostics = response.body?.diagnostics;
    const ready = response.status === 200 &&
      diagnostics?.adminQuery === "configured" &&
      diagnostics?.webhook === "configured" &&
      diagnostics?.onCall === "configured";
    record(context.checks, "diagnostics_health_configured", ready, {
      httpStatus: response.status,
      adminQuery: diagnostics?.adminQuery,
      webhook: diagnostics?.webhook,
      onCall: diagnostics?.onCall,
    });
    if (!ready) {
      context.issues.push("Diagnostics health is not fully configured.");
      context.actions.push(
        "Set DIAGNOSTICS_ADMIN_TOKEN, DIAGNOSTICS_ONCALL_CONTACT, DIAGNOSTICS_ALERT_WEBHOOK_URL, and DIAGNOSTICS_ALERT_WEBHOOK_SECRET.",
      );
    }
  } catch (error) {
    record(context.checks, "diagnostics_health_configured", false, {
      message: errorMessage(error),
    });
    context.issues.push(`Diagnostics health check failed: ${errorMessage(error)}`);
    context.actions.push("Start @translation/api-server and rerun diagnostics alerting readiness.");
  }
}

async function sendAlertTest(context) {
  try {
    const response = await requestJson(context, `${context.apiBaseUrl}/diagnostics/app-errors/alert-test`, {
      method: "POST",
      bearerToken: context.diagnosticsAdminToken,
      allowError: true,
    });
    const ready = response.status === 200 &&
      response.body?.status === "sent" &&
      response.body?.result?.status === "sent";
    record(context.checks, "diagnostics_alert_test_sent", ready, {
      httpStatus: response.status,
      status: response.body?.status,
      result: response.body?.result,
    });
    if (!ready) {
      context.issues.push("Diagnostics alert test was not delivered.");
      context.actions.push("Verify diagnostics webhook URL, secret, robot format, and on-call channel.");
    }
  } catch (error) {
    record(context.checks, "diagnostics_alert_test_sent", false, {
      message: errorMessage(error),
    });
    context.issues.push(`Diagnostics alert test failed: ${errorMessage(error)}`);
  }
}

async function requestJson(context, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs ?? 10_000);
  try {
    const response = await (context.fetchFn ?? fetch)(url, {
      method: init.method ?? "GET",
      headers: init.bearerToken ? { authorization: `Bearer ${init.bearerToken}` } : {},
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok && !init.allowError) {
      throw new Error(body?.error?.message ?? `${url} returned HTTP ${response.status}`);
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function result({ apiBaseUrl, checks, issues, actions }) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    apiBaseUrl,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function normalizeBaseUrl(value) {
  return String(value ?? "").replace(/\/$/, "");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
