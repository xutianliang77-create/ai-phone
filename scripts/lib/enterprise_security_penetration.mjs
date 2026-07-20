import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const environmentName = /^[A-Z][A-Z0-9_]{2,127}$/;
const identifier = /^[a-z][a-z0-9_-]{2,79}$/;
const sha = /^[0-9a-f]{40}$/;
const digest = /^[0-9a-f]{64}$/;
const safeMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const sensitiveHeaders = new Set([
  "authorization", "cookie", "proxy-authorization", "x-api-key",
]);

export function validatePenetrationPlan(plan, policy, allowedHosts = []) {
  const issues = [];
  if (plan?.schemaVersion !== 1) issues.push("Penetration plan schemaVersion must be 1");
  if (!sha.test(plan?.commitSha ?? "")) issues.push("Plan commitSha must be a full Git SHA");
  const target = validateTarget(plan?.target, policy, allowedHosts, issues);
  const cases = Array.isArray(plan?.cases) ? plan.cases : [];
  if (cases.length < (policy?.penetration?.minimumCases ?? Infinity)) {
    issues.push("Penetration plan has fewer cases than policy requires");
  }
  const ids = new Set();
  const categories = new Set();
  cases.forEach((item, index) => validateCase(item, index, ids, categories, issues));
  for (const category of policy?.penetration?.requiredCategories ?? []) {
    if (!categories.has(category)) issues.push(`Missing penetration category: ${category}`);
  }
  return { issues, target };
}

export function createSignedPenetrationEvidence(unsigned, signingKey) {
  assertSigningKey(signingKey);
  return {
    ...unsigned,
    signature: createHmac("sha256", signingKey).update(stableJson(unsigned)).digest("hex"),
  };
}

export function verifyPenetrationEvidence({
  evidence, policy, expectedCommitSha, signingKey, now = new Date(),
}) {
  const issues = [];
  if (evidence?.schemaVersion !== 1 || evidence?.gate !== "enterprise_penetration") {
    issues.push("Penetration evidence schema or gate is invalid");
  }
  if (evidence?.status !== "pass") issues.push("Penetration evidence status is not pass");
  if (evidence?.commitSha !== expectedCommitSha) {
    issues.push("Penetration evidence commit differs from the release candidate");
  }
  const allowed = new Set(policy?.penetration?.allowedEnvironments ?? []);
  if (!allowed.has(evidence?.target?.environment)) {
    issues.push("Penetration evidence environment is not allowed");
  }
  if (evidence?.runner?.name !== "wujie-enterprise-negative-http" ||
    evidence?.runner?.version !== 1) issues.push("Penetration evidence runner is invalid");
  validateEvidenceOrigin(evidence?.target?.origin, issues);
  validateEvidenceTime(evidence, policy, now, issues);
  const cases = Array.isArray(evidence?.cases) ? evidence.cases : [];
  if (cases.length < (policy?.penetration?.minimumCases ?? Infinity)) {
    issues.push("Penetration evidence has too few cases");
  }
  const categories = new Set(cases.map((item) => item.category));
  const caseIds = new Set();
  for (const item of cases) {
    if (!identifier.test(item?.id ?? "") || caseIds.has(item.id) ||
      !identifier.test(item?.category ?? "") || !Array.isArray(item?.attempts) ||
      item.attempts.length < 1 || item.attempts.some((attempt) =>
        attempt.status !== "pass" || !Number.isInteger(attempt.httpStatus) ||
        !digest.test(attempt.responseSha256 ?? ""))) {
      issues.push("Penetration evidence contains an invalid case result");
      break;
    }
    caseIds.add(item.id);
  }
  for (const category of policy?.penetration?.requiredCategories ?? []) {
    if (!categories.has(category)) issues.push(`Evidence is missing category: ${category}`);
  }
  if (cases.some((item) => item.status !== "pass")) {
    issues.push("Penetration evidence contains a failed case");
  }
  const blocked = new Set(policy?.blockedSeverities ?? []);
  if ((evidence?.findings ?? []).some((finding) => blocked.has(finding.severity))) {
    issues.push("Penetration evidence contains P0/P1 findings");
  }
  if (!digest.test(evidence?.planHash ?? "")) issues.push("Evidence planHash is invalid");
  verifySignature(evidence, signingKey, issues);
  return { status: issues.length === 0 ? "pass" : "not_ready", issues };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function validateTarget(target, policy, allowedHosts, issues) {
  if (!policy?.penetration?.allowedEnvironments?.includes(target?.environment)) {
    issues.push("Plan target environment must be test or staging");
  }
  let url;
  try { url = new URL(target?.baseUrl); } catch { issues.push("Plan target baseUrl is invalid"); }
  if (!url) return null;
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    issues.push("Plan target must be an origin without credentials, query, fragment or path");
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!loopback && url.protocol !== "https:") issues.push("Remote penetration targets require HTTPS");
  if (!loopback && !allowedHosts.includes(url.hostname)) {
    issues.push("Remote penetration target is not explicitly allowlisted");
  }
  return { environment: target.environment, origin: url.origin, loopback };
}

function validateCase(item, index, ids, categories, issues) {
  const prefix = `Penetration case ${index + 1}`;
  if (!identifier.test(item?.id ?? "") || ids.has(item.id)) issues.push(`${prefix} id is invalid or duplicate`);
  else ids.add(item.id);
  if (!identifier.test(item?.category ?? "")) issues.push(`${prefix} category is invalid`);
  else categories.add(item.category);
  if (!safeMethods.has(item?.method)) issues.push(`${prefix} method is not allowed`);
  if (typeof item?.path !== "string" || !item.path.startsWith("/") ||
    item.path.startsWith("//") || item.path.includes("\\")) {
    issues.push(`${prefix} path must be origin-relative`);
  }
  const statuses = item?.allowedStatuses;
  if (!Array.isArray(statuses) || statuses.length === 0 ||
    statuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) {
    issues.push(`${prefix} allowedStatuses is invalid`);
  }
  const repeat = item?.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) issues.push(`${prefix} repeat must be 1..5`);
  if (item?.authEnv && !environmentName.test(item.authEnv)) issues.push(`${prefix} authEnv is invalid`);
  for (const [name, value] of Object.entries(item?.headers ?? {})) {
    if (!/^[A-Za-z0-9-]+$/.test(name) || sensitiveHeaders.has(name.toLowerCase()) ||
      typeof value !== "string" || /[\r\n]/.test(value)) {
      issues.push(`${prefix} contains a literal sensitive or non-string header`);
    }
  }
  for (const [name, env] of Object.entries(item?.headerEnvs ?? {})) {
    if (!name || !environmentName.test(env)) issues.push(`${prefix} headerEnvs is invalid`);
  }
  if (item?.body !== undefined && item?.bodyRepeat !== undefined) {
    issues.push(`${prefix} cannot define body and bodyRepeat together`);
  }
  if (item?.bodyRepeat) {
    const value = item.bodyRepeat;
    if (!identifier.test(value.field ?? "") || typeof value.character !== "string" ||
      [...value.character].length !== 1 || !Number.isInteger(value.count) ||
      value.count < 1 || value.count > 2_000_000) issues.push(`${prefix} bodyRepeat is invalid`);
  }
  if ((item?.forbiddenResponseSubstrings ?? []).some((value) =>
    typeof value !== "string" || value.length === 0 || value.length > 512)) {
    issues.push(`${prefix} forbiddenResponseSubstrings is invalid`);
  }
  if ((item?.requiredResponseSubstrings ?? []).some((value) =>
    typeof value !== "string" || value.length === 0 || value.length > 512)) {
    issues.push(`${prefix} requiredResponseSubstrings is invalid`);
  }
  validateCategoryCase(item, prefix, issues);
}

function validateCategoryCase(item, prefix, issues) {
  const rejects = (item.allowedStatuses ?? []).every((status) => status >= 400 && status <= 499);
  if (item.category === "unauthenticated_access" &&
    (item.authEnv || !rejects)) issues.push(`${prefix} unauthenticated case must be unauthenticated and reject`);
  if (["cross_tenant_access", "role_escalation"].includes(item.category) &&
    (!item.authEnv || !rejects)) issues.push(`${prefix} tenant/role attack must authenticate and reject`);
  if (item.category === "tenant_context_spoofing" &&
    (!item.authEnv || Object.keys(item.headers ?? {}).length === 0 ||
      (item.forbiddenResponseSubstrings ?? []).length === 0)) {
    issues.push(`${prefix} tenant spoof case needs auth, spoof headers and a forbidden response value`);
  }
  if (item.category === "webhook_signature_replay" &&
    ((item.repeat ?? 1) < 2 || !rejects)) issues.push(`${prefix} webhook replay must repeat and reject`);
  if (item.category === "payload_limit" &&
    ((item.bodyRepeat?.count ?? 0) < 1_000_000 || !rejects)) {
    issues.push(`${prefix} payload limit case must send at least 1000000 characters and reject`);
  }
}

function validateEvidenceOrigin(value, issues) {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    if (url.origin !== value || url.username || url.password || (!loopback && url.protocol !== "https:")) {
      issues.push("Penetration evidence target origin is invalid");
    }
  } catch { issues.push("Penetration evidence target origin is invalid"); }
}

function validateEvidenceTime(evidence, policy, now, issues) {
  const started = new Date(evidence?.startedAt).getTime();
  const completed = new Date(evidence?.completedAt).getTime();
  const maxAge = (policy?.penetration?.maxEvidenceAgeHours ?? 0) * 3_600_000;
  if (!Number.isFinite(started) || !Number.isFinite(completed) || started > completed ||
    completed > now.getTime() + 300_000 || now.getTime() - completed > maxAge) {
    issues.push("Penetration evidence time window is invalid or expired");
  }
}

function verifySignature(evidence, signingKey, issues) {
  try { assertSigningKey(signingKey); } catch (error) { issues.push(error.message); return; }
  const { signature, ...unsigned } = evidence ?? {};
  const expected = createHmac("sha256", signingKey).update(stableJson(unsigned)).digest("hex");
  if (typeof signature !== "string" || signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    issues.push("Penetration evidence signature is invalid");
  }
}

function assertSigningKey(signingKey) {
  if (typeof signingKey !== "string" || signingKey.length < 32) {
    throw new Error("Enterprise security evidence signing key must be at least 32 characters");
  }
}
