import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  checkDomesticReleaseEnvFile,
  parseEnvFile,
} from
  "./domestic_release_env_file_check.mjs";
import { renderModelRoutingEnv } from "./model_routing_config.mjs";

const stableProjectNames = new Set(["ai-phone"]);
const stableRemoteRoots = new Set(["/data/models/ai-phone-server"]);
const defaultReservedPorts = [
  3110, 3111, 3210, 3211, 8081, 8082, 3310,
  18000, 18002, 18003, 18004, 18081, 18084, 18100,
  18788, 18789, 18883, 18884, 18887,
];
const modelEndpointKeys = new Set([
  "ASR_HTTP_ENDPOINT",
  "ASR_HTTP_FLUSH_ENDPOINT",
  "ASR_HTTP_HEALTH_URL",
  "TRANSLATION_BASE_URL",
  "TTS_HTTP_ENDPOINT",
  "TTS_STREAM_ENDPOINT",
  "TTS_WARMUP_ENDPOINT",
  "SPEAKER_HTTP_BASE_URL",
  "LLM_BASE_URL",
]);

export function checkCoreTranslationCandidateDeploy(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const envFile = path.resolve(
    root,
    options.envFile ?? "release/domestic/release.env",
  );
  const issues = [];
  const checks = [];
  const release = checkDomesticReleaseEnvFile({ root, file: envFile });
  record(checks, "domestic_release_env", release.status === "ready", {
    profile: release.profile,
    filePath: release.filePath,
  });
  if (release.status !== "ready") issues.push(...release.issues);
  requireExactPrivateMode(envFile, checks, issues);
  requireCoreProfile(release.profile, checks, issues);
  requireDedicatedResources(root, envFile, checks, issues);

  const composeProject = options.composeProject ?? "ai-phone-core-candidate";
  const containerPrefix = options.containerPrefix ?? composeProject;
  const remoteRoot = options.remoteRoot ??
    "/data/models/ai-phone-server-candidates/core-translation";
  requireIsolatedName(
    "COMPOSE_PROJECT_NAME",
    composeProject,
    stableProjectNames,
    checks,
    issues,
  );
  requireIsolatedName(
    "AI_PHONE_CONTAINER_PREFIX",
    containerPrefix,
    stableProjectNames,
    checks,
    issues,
  );
  requireRemoteRoot(remoteRoot, checks, issues);

  const ports = {
    api: numberValue(options.apiPort ?? 3320),
    realtime: numberValue(options.realtimePort ?? 3321),
    translationAgent: numberValue(options.translationAgentPort ?? 8381),
  };
  const reservedPorts = new Set(
    (options.reservedPorts ?? defaultReservedPorts).map(numberValue),
  );
  requireCandidatePorts(ports, reservedPorts, checks, issues);

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    envFile,
    profile: release.profile,
    composeProject,
    containerPrefix,
    remoteRoot,
    ports,
    checks,
    issues: [...new Set(issues)],
    actions: issues.length === 0
      ? []
      : ["Correct the candidate deployment contract before any remote write."],
  };
}

function requireDedicatedResources(root, envFile, checks, issues) {
  const env = readCandidateEnv(envFile);
  const modeReady = env.WUJIE_RESOURCE_ISOLATION_MODE === "dedicated_host";
  record(checks, "candidate_resource_isolation_mode", modeReady, {
    expected: "dedicated_host",
    actual: env.WUJIE_RESOURCE_ISOLATION_MODE ?? "",
  });
  if (!modeReady) {
    issues.push(
      "core candidate requires WUJIE_RESOURCE_ISOLATION_MODE=dedicated_host",
    );
  }

  const resourceDomain = env.WUJIE_RESOURCE_DOMAIN ?? "";
  const domainReady = /^wujie-[a-z0-9][a-z0-9-]{2,62}$/.test(resourceDomain) &&
    !/(maruko|xiaozhi)/i.test(resourceDomain);
  record(checks, "candidate_resource_domain", domainReady, {
    value: resourceDomain,
  });
  if (!domainReady) {
    issues.push("core candidate requires an isolated WUJIE_RESOURCE_DOMAIN");
  }

  const dedicatedHosts = commaSeparated(env.WUJIE_DEDICATED_MODEL_HOSTS)
    .map(normalizeHostname)
    .filter(Boolean);
  const hostsReady = dedicatedHosts.length > 0;
  record(checks, "candidate_dedicated_model_hosts", hostsReady, {
    hosts: dedicatedHosts,
  });
  if (!hostsReady) {
    issues.push("core candidate requires WUJIE_DEDICATED_MODEL_HOSTS");
  }

  const endpoints = candidateModelEndpoints(root, env);
  const violations = endpoints.filter((endpoint) =>
    !endpoint.hostname || !dedicatedHosts.includes(endpoint.hostname)
  );
  const endpointsReady = endpoints.length > 0 && violations.length === 0;
  record(checks, "candidate_model_endpoint_isolation", endpointsReady, {
    endpoints: endpoints.map(endpointSummary),
    violations: violations.map(endpointSummary),
  });
  if (!endpointsReady) {
    issues.push(
      "core candidate model endpoints must use WUJIE_DEDICATED_MODEL_HOSTS",
    );
  }
}

function readCandidateEnv(envFile) {
  if (!existsSync(envFile)) return {};
  return parseEnvFile(readFileSync(envFile, "utf8"));
}

function candidateModelEndpoints(root, env) {
  const endpoints = endpointEntries("release_env", env);
  if (!env.MODEL_ROUTING_FILE) return endpoints;
  try {
    const rendered = renderModelRoutingEnv(
      path.resolve(root, env.MODEL_ROUTING_FILE),
      env.MODEL_ROUTING_PROFILE,
    );
    for (const [group, values] of Object.entries(rendered.groups)) {
      endpoints.push(...endpointEntries(`model_routing:${group}`, values));
    }
  } catch {
    // The domestic release gate reports malformed routing separately.
  }
  return endpoints;
}

function endpointEntries(source, values) {
  return Object.entries(values)
    .filter(([key, value]) => modelEndpointKeys.has(key) && value)
    .map(([key, value]) => {
      try {
        const url = new URL(value);
        return {
          source,
          key,
          hostname: normalizeHostname(url.hostname),
          port: url.port || defaultPort(url.protocol),
        };
      } catch {
        return { source, key, hostname: "", port: "" };
      }
    });
}

function endpointSummary(endpoint) {
  return {
    source: endpoint.source,
    key: endpoint.key,
    hostname: endpoint.hostname,
    port: endpoint.port,
  };
}

function commaSeparated(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeHostname(value = "") {
  return value.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

function defaultPort(protocol) {
  return protocol === "https:" || protocol === "wss:" ? "443" :
    protocol === "http:" || protocol === "ws:" ? "80" : "";
}

function requireExactPrivateMode(filePath, checks, issues) {
  if (!existsSync(filePath)) return;
  const stat = statSync(filePath);
  const mode = stat.mode & 0o777;
  const ok = stat.isFile() && mode === 0o600;
  record(checks, "candidate_env_file_mode", ok, {
    mode: mode.toString(8).padStart(3, "0"),
  });
  if (!ok) issues.push("core candidate env file must be a regular 0600 file");
}

function requireCoreProfile(profile, checks, issues) {
  const ok = profile === "core_translation";
  record(checks, "candidate_capability_profile", ok, { profile });
  if (!ok) issues.push("core candidate requires core_translation profile");
}

function requireIsolatedName(key, value, reserved, checks, issues) {
  const ok = /^[a-z0-9][a-z0-9_-]{2,62}$/.test(value) &&
    !reserved.has(value);
  record(checks, key, ok, { value });
  if (!ok) issues.push(`${key} must be a non-production isolated name`);
}

function requireRemoteRoot(value, checks, issues) {
  const ok = /^\/[A-Za-z0-9._/-]+$/.test(value) &&
    !stableRemoteRoots.has(value) &&
    value.includes("candidate");
  record(checks, "REMOTE_ROOT", ok, { value });
  if (!ok) issues.push("REMOTE_ROOT must be an isolated candidate path");
}

function requireCandidatePorts(ports, reserved, checks, issues) {
  const values = Object.values(ports);
  const valid = values.every((value) =>
    Number.isInteger(value) && value >= 1 && value <= 65535
  );
  const unique = new Set(values).size === values.length;
  const isolated = values.every((value) => !reserved.has(value));
  record(checks, "candidate_ports", valid && unique && isolated, {
    ...ports,
    reservedConflict: values.filter((value) => reserved.has(value)),
  });
  if (!valid) issues.push("candidate ports must be integers from 1 to 65535");
  if (!unique) issues.push("candidate ports must be unique");
  if (!isolated) issues.push("candidate ports conflict with reserved services");
}

function numberValue(value) {
  return typeof value === "number" ? value : Number(value);
}

function record(checks, name, ok, details) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
