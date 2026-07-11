import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { probeApiModelRouting } from "./domestic_local_stack_model_routing_probe.mjs";
import { renderModelRoutingEnv } from "./model_routing_config.mjs";

const DEFAULT_MODEL_ROUTING_FILE = "release/domestic/model-routing.json";

export function buildDomesticLocalStackConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const apiPort = Number(options.apiPort ?? 3410);
  const gatewayPort = Number(options.gatewayPort ?? 3411);
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
  const realtimeSecret =
    options.realtimeTokenSecret ?? "local-domestic-realtime-secret";
  const internalSecret =
    options.internalApiSecret ?? "local-domestic-internal-secret";
  const cacheDir =
    options.cacheDir ?? path.join(root, ".cache/domestic-local-stack");
  const modelRoutingFile = options.modelRoutingFile || options.modelRoutingProfile
    ? resolveModelRoutingFile(
        root,
        options.modelRoutingFile ?? DEFAULT_MODEL_ROUTING_FILE,
      )
    : null;
  const routedGatewayEnv = modelRoutingFile
    ? renderModelRoutingEnv(
        modelRoutingFile,
        options.modelRoutingProfile,
        "gateway",
      ).groups.gateway
    : {};

  const common = {
    REGION_EDITION: "domestic",
    DATA_REGION: "cn",
    COMPLIANCE_PROFILE: "pipl",
    CALL_PROVIDER_POLICY: "call_link_only",
    INTERNAL_API_SECRET: internalSecret,
  };
  return {
    root,
    apiPort,
    gatewayPort,
    apiBaseUrl,
    gatewayBaseUrl,
    cacheDir,
    logs: {
      api: path.join(cacheDir, "api-server.log"),
      gateway: path.join(cacheDir, "realtime-gateway.log"),
    },
    apiEnv: {
      ...common,
      API_PORT: String(apiPort),
      API_DATA_FILE: path.join(cacheDir, "api-store.json"),
      ACTIVE_PLAN_CODE: "free",
      REALTIME_TOKEN_SECRET: realtimeSecret,
      REALTIME_WS_ENDPOINT: `ws://127.0.0.1:${gatewayPort}/realtime`,
      PUBLIC_CALL_BASE_URL: `http://127.0.0.1:${apiPort}/join`,
      ...(modelRoutingFile
        ? {
            MODEL_ROUTING_FILE: modelRoutingFile,
            ...(options.modelRoutingProfile
              ? { MODEL_ROUTING_PROFILE: options.modelRoutingProfile }
              : {}),
          }
        : {}),
      ...(options.releaseMaterialsFile
        ? {
            RELEASE_MATERIALS_FILE: resolveReleaseMaterialsFile(
              root,
              options.releaseMaterialsFile,
            ),
          }
        : {}),
    },
    gatewayEnv: {
      ...common,
      ...routedGatewayEnv,
      REALTIME_PORT: String(gatewayPort),
      REALTIME_TOKEN_SECRET: realtimeSecret,
      REALTIME_PROVIDER:
        options.realtimeProvider ??
        routedGatewayEnv.REALTIME_PROVIDER ??
        "hymt2_self_hosted",
      SESSION_EVENT_SINK:
        options.sessionEventSink ?? routedGatewayEnv.SESSION_EVENT_SINK ?? "api",
      API_BASE_URL: apiBaseUrl,
      ASR_PROVIDER: options.asrProvider ?? routedGatewayEnv.ASR_PROVIDER ?? "http",
      ASR_HTTP_ENDPOINT:
        options.asrHttpEndpoint ??
        routedGatewayEnv.ASR_HTTP_ENDPOINT ??
        "http://127.0.0.1:8001/asr/transcribe",
      ASR_HTTP_FLUSH_ENDPOINT:
        options.asrHttpFlushEndpoint ??
        routedGatewayEnv.ASR_HTTP_FLUSH_ENDPOINT ??
        "http://127.0.0.1:8001/asr/sessions/:sessionId/flush",
      TRANSLATION_BASE_URL:
        options.lmStudioBaseUrl ??
        routedGatewayEnv.TRANSLATION_BASE_URL ??
        "http://127.0.0.1:1234/v1",
      TRANSLATION_MODEL:
        options.lmStudioModel ??
        routedGatewayEnv.TRANSLATION_MODEL ??
        "tencent/Hy-MT2-1.8B",
      ...(modelRoutingFile
        ? {
            MODEL_ROUTING_FILE: modelRoutingFile,
            ...(options.modelRoutingProfile
              ? { MODEL_ROUTING_PROFILE: options.modelRoutingProfile }
              : {}),
          }
        : {}),
    },
  };
}

export async function checkDomesticLocalStack(options = {}) {
  return withDomesticLocalStack(options, async (config) =>
    probeDomesticLocalStack({ ...options, config }),
  );
}

export async function withDomesticLocalStack(options = {}, callback) {
  const config = buildDomesticLocalStackConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  const services = [
    startService(config, "api", "@translation/api-server", config.apiEnv),
    startService(
      config,
      "gateway",
      "@translation/realtime-gateway",
      config.gatewayEnv,
    ),
  ];

  try {
    await waitForService({
      label: "api",
      url: `${config.apiBaseUrl}/health`,
      service: services[0],
      timeoutMs: options.timeoutMs ?? 15_000,
      fetchFn: options.fetchFn,
    });
    await waitForService({
      label: "gateway",
      url: `${config.gatewayBaseUrl}/health`,
      service: services[1],
      timeoutMs: options.timeoutMs ?? 15_000,
      fetchFn: options.fetchFn,
    });
    return await callback(config);
  } finally {
    await stopServices(services);
  }
}

export async function probeDomesticLocalStack(options = {}) {
  const config = options.config ?? buildDomesticLocalStackConfig(options);
  const checks = [];
  const issues = [];
  const actions = [];
  await probeService({
    checks,
    issues,
    actions,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs ?? 10_000,
    name: "api",
    baseUrl: config.apiBaseUrl,
    expectedService: "api-server",
    logPath: config.logs.api,
  });
  await probeApiModelRouting({
    checks,
    issues,
    actions,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs ?? 10_000,
    baseUrl: config.apiBaseUrl,
    logPath: config.logs.api,
    record,
    requestJson,
  });
  await probeService({
    checks,
    issues,
    actions,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs ?? 10_000,
    name: "gateway",
    baseUrl: config.gatewayBaseUrl,
    expectedService: "realtime-gateway",
    logPath: config.logs.gateway,
  });
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    apiBaseUrl: config.apiBaseUrl,
    gatewayBaseUrl: config.gatewayBaseUrl,
    logs: config.logs,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

function startService(config, name, workspace, env) {
  const log = createWriteStream(config.logs[name], { flags: "w" });
  const child = spawn("npm", ["run", "dev", "-w", workspace], {
    cwd: config.root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const service = {
    name,
    child,
    logPath: config.logs[name],
    exited: false,
    exitCode: null,
  };
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code) => {
    service.exited = true;
    service.exitCode = code;
  });
  return service;
}

async function waitForService(options) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (options.service.exited) {
      throw new Error(
        `${options.label} exited early; see ${options.service.logPath}`,
      );
    }
    try {
      const response = await requestJson(options.url, options);
      if (response.status === 200) return;
    } catch {
      // Keep polling until timeout; startup races are expected here.
    }
    await sleep(250);
  }
  throw new Error(
    `${options.label} did not become healthy; see ${options.service.logPath}`,
  );
}

async function probeService(context) {
  const health = await requestJson(`${context.baseUrl}/health`, context);
  const identityOk =
    health.status === 200 && health.body?.service === context.expectedService;
  record(context.checks, `${context.name}_service_identity`, identityOk, {
    httpStatus: health.status,
    service: health.body?.service,
    version: health.body?.version,
  });
  if (!identityOk) {
    context.issues.push(`${context.name} service identity mismatch.`);
    context.actions.push(`Check ${context.name} log at ${context.logPath}.`);
  }

  const release = await requestJson(`${context.baseUrl}/health/release-ready`, {
    ...context,
    allowError: true,
  });
  const routeOk =
    [200, 503].includes(release.status) &&
    ["ready", "not_ready"].includes(release.body?.status);
  record(context.checks, `${context.name}_release_ready_route`, routeOk, {
    httpStatus: release.status,
    status: release.body?.status,
    issues: release.body?.issues ?? [],
  });
  if (!routeOk) {
    context.issues.push(
      `${context.name} /health/release-ready route is missing or malformed.`,
    );
    context.actions.push(
      `Restart ${context.name} from the current workspace and inspect ${context.logPath}.`,
    );
  }
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetchFn ?? fetch)(url, {
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok && !options.allowError) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function resolveReleaseMaterialsFile(root, file) {
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

function resolveModelRoutingFile(root, file) {
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

async function stopServices(services) {
  for (const service of services) {
    if (!service.exited) service.child.kill("SIGTERM");
  }
  await Promise.all(services.map((service) => waitForExit(service)));
}

function waitForExit(service) {
  if (service.exited) return Promise.resolve();
  return new Promise((resolve) => {
    service.child.once("exit", resolve);
    setTimeout(resolve, 2000);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
