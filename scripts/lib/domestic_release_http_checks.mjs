export async function checkServiceIdentity(context) {
  try {
    const response = await requestJson(context.url, {
      fetchFn: context.fetchFn,
      timeoutMs: context.timeoutMs,
      allowError: true,
    });
    const service = response.body?.service;
    const ready =
      response.status === 200 && service === context.expectedService;
    record(context.checks, context.name, ready, {
      httpStatus: response.status,
      service,
      version: response.body?.version,
      status: response.body?.status,
    });
    if (!ready) {
      context.issues.push(
        `${context.name} failed: expected ${context.expectedService}, got ${service ?? `HTTP ${response.status}`}.`,
      );
      context.actions.push(context.action);
    }
  } catch (error) {
    record(context.checks, context.name, false, {
      message: errorMessage(error),
    });
    context.issues.push(`${context.name} failed: ${errorMessage(error)}`);
    context.actions.push(context.action);
  }
}

export async function checkReleaseEndpoint(context) {
  try {
    const response = await requestJson(context.url, {
      fetchFn: context.fetchFn,
      timeoutMs: context.timeoutMs,
      allowError: true,
    });
    const ready = response.status === 200 && response.body?.status === "ready";
    record(context.checks, context.name, ready, {
      httpStatus: response.status,
      status: response.body?.status,
      issues: response.body?.issues ?? [],
    });
    if (!ready) {
      context.issues.push(`${context.name} is not ready.`);
      context.issues.push(...normalizeIssues(response.body?.issues));
      context.actions.push(
        `Fix ${context.name} issues and rerun domestic release readiness.`,
      );
      if (response.status === 404 && context.missingRouteAction) {
        context.issues.push(
          `${context.name} route is missing at ${context.url}.`,
        );
        context.actions.push(context.missingRouteAction);
      }
    }
  } catch (error) {
    record(context.checks, context.name, false, {
      message: errorMessage(error),
    });
    context.issues.push(`${context.name} failed: ${errorMessage(error)}`);
  }
}

export function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

export function normalizeBaseUrl(value) {
  return String(value ?? "").replace(/\/$/, "");
}

export function normalizeIssues(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.length > 0)
    : [];
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetchFn ?? fetch)(url, {
      method: options.body ? "POST" : "GET",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.apiKey
          ? { authorization: `Bearer ${options.apiKey}` }
          : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok && !options.allowError) {
      throw new Error(
        body?.error?.message ?? `${url} returned HTTP ${response.status}`,
      );
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
