import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnvFile } from "./domestic_release_env_file_check.mjs";

const privateModelEndpointKeys = [
  "ASR_HTTP_ENDPOINT",
  "ASR_HTTP_FLUSH_ENDPOINT",
  "ASR_HTTP_HEALTH_URL",
  "TRANSLATION_BASE_URL",
  "TTS_HTTP_ENDPOINT",
  "TTS_STREAM_ENDPOINT",
  "TTS_WARMUP_ENDPOINT",
  "SPEAKER_HTTP_BASE_URL",
  "LLM_BASE_URL",
];
const reservedPorts = new Set([
  3110, 3111, 3210, 3211, 8081, 8082, 3310,
  18000, 18002, 18003, 18004, 18081, 18084, 18100,
  18788, 18789, 18883, 18884, 18887,
]);
const componentNames = new Set(["asr", "translation", "tts"]);

/**
 * Offline-only contract check for the isolated public candidate described by
 * V11-19. It intentionally validates the environment surface, rather than
 * loading credentials, calling a provider, or declaring a runtime ready.
 */
export function checkPublicRuntimeCandidateDeploy(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const apiEnvFile = resolve(root, options.apiEnvFile ?? "public-api.env");
  const gatewayEnvFile = resolve(
    root,
    options.gatewayEnvFile ?? "public-gateway.env",
  );
  const checks = [];
  const issues = [];
  const api = loadProtectedEnv("api_env", apiEnvFile, checks, issues);
  const gateway = loadProtectedEnv(
    "gateway_env",
    gatewayEnvFile,
    checks,
    issues,
  );
  const materialFile = materialFileResolver(options);

  requireCandidateIdentity(options, checks, issues);
  requirePublicRuntime(api, gateway, checks, issues);
  requireApiMaterialFiles(api, materialFile, checks, issues);
  requireLiveQualification(api, gateway, materialFile, checks, issues);
  requireNoPrivateFallback(api, gateway, checks, issues);

  return {
    status: issues.length === 0 ? "ready_for_runtime_validation" : "not_ready",
    apiEnvFile,
    gatewayEnvFile,
    composeProject: options.composeProject ?? "wujie-v11-public-candidate",
    containerPrefix: options.containerPrefix ?? "wujie-v11-public-candidate",
    remoteRoot: options.remoteRoot ??
      "/data/models/ai-phone-server-candidates/wujie-v11-public",
    ports: candidatePorts(options),
    checks,
    issues: [...new Set(issues)],
    actions: issues.length === 0
      ? [
        "Run the API and Gateway runtime health checks before treating dependencies as ready.",
      ]
      : ["Correct this isolated candidate contract before any remote write."],
  };
}

function resolve(root, value) {
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function loadProtectedEnv(name, file, checks, issues) {
  const protectedFile = protectedRegularFile(file);
  record(checks, name, protectedFile.ok, { path: file });
  if (!protectedFile.ok) {
    issues.push(`${name} must be a regular 0600 file`);
    return {};
  }
  return parseEnvFile(readFileSync(file, "utf8"));
}

function protectedRegularFile(file) {
  try {
    if (!existsSync(file)) return { ok: false };
    const stat = lstatSync(file);
    return { ok: stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o600 };
  } catch {
    return { ok: false };
  }
}

function requireCandidateIdentity(options, checks, issues) {
  const composeProject = options.composeProject ?? "wujie-v11-public-candidate";
  const containerPrefix = options.containerPrefix ?? composeProject;
  const remoteRoot = options.remoteRoot ??
    "/data/models/ai-phone-server-candidates/wujie-v11-public";
  const nameOk = (value) => /^[a-z0-9][a-z0-9_-]{2,62}$/.test(value) &&
    !["ai-phone", "wujie-ai"].includes(value);
  record(checks, "candidate_names", nameOk(composeProject) && nameOk(containerPrefix), {
    composeProject,
    containerPrefix,
  });
  if (!nameOk(composeProject) || !nameOk(containerPrefix)) {
    issues.push("candidate compose and container names must be isolated");
  }
  const rootOk = /^\/[A-Za-z0-9._/-]+$/.test(remoteRoot) &&
    remoteRoot.includes("candidate") &&
    remoteRoot !== "/data/models/ai-phone-server";
  record(checks, "candidate_remote_root", rootOk, { remoteRoot });
  if (!rootOk) issues.push("candidate remote root must be an isolated candidate path");

  const ports = candidatePorts(options);
  const values = Object.values(ports);
  const portsOk = values.every((value) => Number.isInteger(value) && value > 0 && value <= 65535) &&
    new Set(values).size === values.length && values.every((value) => !reservedPorts.has(value));
  record(checks, "candidate_ports", portsOk, {
    ...ports,
    reservedConflict: values.filter((value) => reservedPorts.has(value)),
  });
  if (!portsOk) issues.push("candidate ports must be unique and outside reserved services");
}

function candidatePorts(options) {
  return {
    api: number(options.apiPort ?? 13110),
    gateway: number(options.gatewayPort ?? 13111),
    internalTls: number(options.internalTlsPort ?? 13112),
  };
}

function materialFileResolver(options) {
  const hostRoot = options.materialRoot;
  const containerRoot = options.containerMaterialRoot;
  if (hostRoot === undefined && containerRoot === undefined) return (value) => value;
  if (!path.isAbsolute(hostRoot ?? "") || !path.isAbsolute(containerRoot ?? "")) {
    return () => "";
  }
  const normalizedContainerRoot = path.resolve(containerRoot);
  const normalizedHostRoot = path.resolve(hostRoot);
  return (value) => {
    if (!path.isAbsolute(value ?? "")) return "";
    const relative = path.relative(normalizedContainerRoot, path.resolve(value));
    if (!relative || relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      return "";
    }
    return path.resolve(normalizedHostRoot, relative);
  };
}

function number(value) {
  return typeof value === "number" ? value : Number(value);
}

function requirePublicRuntime(api, gateway, checks, issues) {
  const enabled = api.PUBLIC_RUNTIME_ENABLED === "true" &&
    gateway.PUBLIC_RUNTIME_ENABLED === "true";
  record(checks, "public_runtime_enabled", enabled, { api: api.PUBLIC_RUNTIME_ENABLED === "true", gateway: gateway.PUBLIC_RUNTIME_ENABLED === "true" });
  if (!enabled) issues.push("public runtime must be explicitly enabled for both API and Gateway");

  const apiDeployment = api.API_RESULT_SYNC_DEPLOYMENT_ID ?? "";
  const deploymentOk = /^[A-Za-z0-9._-]{1,120}$/.test(apiDeployment) &&
    apiDeployment === gateway.API_RESULT_SYNC_DEPLOYMENT_ID;
  record(checks, "public_deployment_binding", deploymentOk, { configured: Boolean(apiDeployment) });
  if (!deploymentOk) issues.push("API and Gateway must share a valid public deployment identity");

  const credentialSecret = api.PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET;
  const credentialOk = safeSecret(credentialSecret) &&
    credentialSecret === gateway.PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET &&
    credentialSecret !== api.INTERNAL_API_SECRET &&
    credentialSecret !== api.REALTIME_TOKEN_SECRET &&
    credentialSecret !== gateway.INTERNAL_API_SECRET &&
    credentialSecret !== gateway.REALTIME_TOKEN_SECRET;
  record(checks, "gateway_credential_secret_boundary", credentialOk, { configured: Boolean(credentialSecret) });
  if (!credentialOk) {
    issues.push("public Gateway credential access secret must be shared only by API and Gateway");
  }
}

function requireApiMaterialFiles(api, materialFile, checks, issues) {
  const configurationFile = api.PUBLIC_MODEL_CONFIG_FILE ?? "";
  const configurationFileOk = absoluteProtectedFile(materialFile(configurationFile));
  record(checks, "public_model_configuration_file", configurationFileOk, { configured: Boolean(configurationFile) });
  if (!configurationFileOk) issues.push("public model configuration file must be an absolute regular 0600 file");
  const configurationKeyOk = hexKey(api.PUBLIC_MODEL_CONFIG_KEY);
  record(checks, "public_model_configuration_key", configurationKeyOk, { configured: Boolean(api.PUBLIC_MODEL_CONFIG_KEY) });
  if (!configurationKeyOk) issues.push("public model configuration key must be a 64-character hexadecimal key");

  const policyFile = api.PUBLIC_RUNTIME_ADMISSION_POLICY_FILE ?? "";
  const policyFileOk = absoluteProtectedFile(materialFile(policyFile));
  record(checks, "public_admission_policy_file", policyFileOk, { configured: Boolean(policyFile) });
  if (!policyFileOk) issues.push("public admission policy file must be an absolute regular 0600 file");
  const policyKeyOk = hexKey(api.PUBLIC_RUNTIME_ADMISSION_POLICY_KEY);
  record(checks, "public_admission_policy_key", policyKeyOk, { configured: Boolean(api.PUBLIC_RUNTIME_ADMISSION_POLICY_KEY) });
  if (!policyKeyOk) issues.push("public admission policy key must be a 64-character hexadecimal key");

  const privateFile = api.PRIVATE_MODEL_CONFIG_FILE;
  const noCollision = !privateFile || privateFile !== configurationFile;
  record(checks, "public_private_configuration_separation", noCollision, { privateConfigured: Boolean(privateFile) });
  if (!noCollision) issues.push("public and private model configuration files must differ");
}

function requireLiveQualification(api, gateway, materialFile, checks, issues) {
  const required = api.PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION === "true";
  record(checks, "api_live_qualification_required", required, { configured: required });
  if (!required) issues.push("public API candidate must require signed live qualification");

  const apiFile = api.PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE ?? "";
  const gatewayFile = gateway.PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE ?? "";
  const liveFileOk = absoluteProtectedFile(materialFile(apiFile)) && apiFile === gatewayFile;
  record(checks, "live_qualification_file_binding", liveFileOk, { configured: Boolean(apiFile) });
  if (!liveFileOk) issues.push("API and Gateway must share an absolute regular live qualification file");

  const apiKey = api.PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY;
  const liveKeyOk = hexKey(apiKey) && apiKey === gateway.PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY;
  record(checks, "live_qualification_key_binding", liveKeyOk, { configured: Boolean(apiKey) });
  if (!liveKeyOk) issues.push("API and Gateway must share a 64-character live qualification key");

  const hashOk = /^[a-f0-9]{64}$/i.test(gateway.PUBLIC_RUNTIME_CONFIGURATION_HASH ?? "");
  const revisionOk = /^[A-Za-z0-9._:-]{1,160}$/.test(gateway.PUBLIC_RUNTIME_MODEL_POLICY_REVISION ?? "");
  const components = split(gateway.PUBLIC_RUNTIME_ACTIVE_COMPONENTS);
  const componentsOk = components.length > 0 &&
    components.every((value) => componentNames.has(value)) &&
    new Set(components).size === components.length;
  record(checks, "gateway_live_qualification_scope", hashOk && revisionOk && componentsOk, {
    configurationHashConfigured: hashOk,
    modelPolicyRevisionConfigured: revisionOk,
    components,
  });
  if (!hashOk || !revisionOk || !componentsOk) {
    issues.push("Gateway must declare a bounded live-qualification configuration scope");
  }
}

function requireNoPrivateFallback(api, gateway, checks, issues) {
  const configuredPrivateEndpoints = privateModelEndpointKeys.filter((key) =>
    hasValue(api[key]) || hasValue(gateway[key])
  );
  const ok = configuredPrivateEndpoints.length === 0;
  record(checks, "private_model_endpoint_fallback_absent", ok, { configuredKeys: configuredPrivateEndpoints });
  if (!ok) issues.push("public candidate must not carry private model endpoint fallback configuration");
}

function absoluteProtectedFile(value) {
  return path.isAbsolute(value) && protectedRegularFile(value).ok;
}

function safeSecret(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 4096 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function hexKey(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function split(value) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function record(checks, name, ok, details) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
