import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

export function resolveEnterprisePostgresDrBinding(options = {}) {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;
  const cutoverFile = repositoryFile(
    root,
    required(env.ENTERPRISE_CUTOVER_EVIDENCE_FILE,
      "ENTERPRISE_CUTOVER_EVIDENCE_FILE"),
  );
  const cutoverContents = readFile(cutoverFile, "enterprise cutover evidence");
  const cutover = parseJson(cutoverContents, "enterprise cutover evidence");
  const cutoverSigningKey = requiredKey(
    env.ENTERPRISE_CUTOVER_EVIDENCE_HMAC_KEY,
    "ENTERPRISE_CUTOVER_EVIDENCE_HMAC_KEY",
  );
  const drSigningKey = enterprisePostgresDrSigningKey(env);
  if (cutoverSigningKey === drSigningKey) {
    throw new Error("Enterprise cutover and DR evidence keys must be distinct");
  }
  verifyCutoverEvidence(cutover, cutoverSigningKey);
  const gitCommit = required(
    env.ENTERPRISE_RUNTIME_GIT_COMMIT,
    "ENTERPRISE_RUNTIME_GIT_COMMIT",
  );
  const imageDigest = required(
    env.ENTERPRISE_RUNTIME_IMAGE_DIGEST,
    "ENTERPRISE_RUNTIME_IMAGE_DIGEST",
  );
  const topologySha256 = fileSha256(options.topologyFile);
  const migrations = currentMigrationManifest(root);
  if (!/^[0-9a-f]{7,40}$/i.test(gitCommit) ||
    !/^sha256:[0-9a-f]{64}$/i.test(imageDigest) ||
    migrations.publicMigrations.length !== 31 ||
    migrations.enterpriseMigrations.length !== 55) {
    throw new Error("Enterprise DR candidate or migration manifest is invalid");
  }
  if (cutover.phase !== "cutover" || cutover.status !== "matched" ||
    cutover.environment !== "staging" || cutover.comparison?.status !== "matched" ||
    cutover.source?.sha256 !== cutover.target?.sha256 ||
    cutover.gitCommit !== gitCommit || cutover.imageDigest !== imageDigest ||
    cutover.topologySha256 !== topologySha256 ||
    !same(cutover.target?.publicMigrations, migrations.publicMigrations) ||
    !same(cutover.target?.enterpriseMigrations, migrations.enterpriseMigrations)) {
    throw new Error("Enterprise cutover evidence does not match the DR candidate");
  }
  if (!readyCutoverEvidence(cutover)) {
    throw new Error("Enterprise cutover evidence is not production-ready");
  }
  const database = cutover.target?.database;
  if (!validId(cutover.cutoverId) || !validId(cutover.runId) ||
    !validId(cutover.target?.logicalId) || !validId(database?.systemIdentifier) ||
    !validId(database?.oid) || !sha256(cutover.target?.sha256)) {
    throw new Error("Enterprise cutover database binding is invalid");
  }
  return {
    gitCommit,
    imageDigest,
    topologySha256,
    cutoverEvidenceSha256: sha256Hex(cutoverContents),
    cutoverId: cutover.cutoverId,
    cutoverRunId: cutover.runId,
    database: {
      logicalId: cutover.target.logicalId,
      name: database.name,
      systemIdentifier: database.systemIdentifier,
      oid: database.oid,
      manifestSha256: cutover.target.sha256,
    },
    migrations: {
      publicCount: migrations.publicMigrations.length,
      enterpriseCount: migrations.enterpriseMigrations.length,
      sha256: sha256Hex(stableJson(migrations)),
    },
  };
}

export function enterprisePostgresDrSigningKey(env = process.env) {
  return requiredKey(
    env.ENTERPRISE_POSTGRES_DR_EVIDENCE_HMAC_KEY,
    "ENTERPRISE_POSTGRES_DR_EVIDENCE_HMAC_KEY",
  );
}

export function isEnterprisePostgresDrBinding(value) {
  return isObject(value) && /^[0-9a-f]{7,40}$/i.test(value.gitCommit ?? "") &&
    /^sha256:[0-9a-f]{64}$/i.test(value.imageDigest ?? "") &&
    sha256(value.topologySha256) &&
    sha256(value.cutoverEvidenceSha256) && validId(value.cutoverId) &&
    validId(value.cutoverRunId) && validId(value.database?.logicalId) &&
    validId(value.database?.name) &&
    validId(value.database?.systemIdentifier) && validId(value.database?.oid) &&
    sha256(value.database?.manifestSha256) &&
    value.migrations?.publicCount === 31 &&
    value.migrations?.enterpriseCount === 55 && sha256(value.migrations?.sha256);
}

function readyCutoverEvidence(value) {
  const baseline = value.baseline;
  const fence = value.writerFence;
  return timestamp(value.capturedAt) && sha256(baseline?.fileSha256) &&
    baseline?.sourceSha256 === value.source?.sha256 && walLsn(baseline?.sourceWalLsn) &&
    fence?.sourceDefaultReadOnly === true &&
    fence?.sourceWriteProbeRejected === true &&
    fence?.sourceActiveWriterSessions === 0 &&
    fence?.targetDefaultReadOnly === false &&
    fence?.targetWriteProbeSucceeded === true &&
    fence?.targetActiveWriterSessions === 0 &&
    Array.isArray(fence?.writerRoles) && fence.writerRoles.length > 0 &&
    fence.writerRoles.every(validId) && validId(value.target?.database?.name) &&
    isObject(value.target?.critical) && Object.keys(value.target.critical).length > 0;
}

export function signEnterprisePostgresDrResult(result, signingKey) {
  if (result?.schemaVersion !== 2 ||
    !isEnterprisePostgresDrBinding(result.enterprise)) {
    throw new Error("Enterprise PostgreSQL DR result is invalid");
  }
  const unsigned = { ...result };
  delete unsigned.signature;
  return { ...unsigned, signature: hmac(unsigned, requiredKey(signingKey, "DR key")) };
}

export function verifyEnterprisePostgresDrResult(result, binding, signingKey) {
  if (!isObject(result) || result.schemaVersion !== 2 ||
    !isEnterprisePostgresDrBinding(binding) ||
    typeof result.signature !== "string" || !same(result.enterprise, binding)) {
    throw new Error("Enterprise PostgreSQL DR binding is invalid");
  }
  const { signature, ...unsigned } = result;
  const expected = hmac(unsigned, requiredKey(signingKey, "DR key"));
  if (!safeEqual(signature, expected)) {
    throw new Error("Enterprise PostgreSQL DR signature is invalid");
  }
  return result;
}

function verifyCutoverEvidence(value, signingKey) {
  if (!isObject(value) || value.formatVersion !== 1 ||
    value.kind !== "enterprise_primary_cutover" ||
    typeof value.signature !== "string") {
    throw new Error("Enterprise cutover evidence is invalid");
  }
  const { signature, ...unsigned } = value;
  if (!safeEqual(signature, hmac(unsigned, signingKey))) {
    throw new Error("Enterprise cutover evidence signature is invalid");
  }
}

function currentMigrationManifest(root) {
  const publicDirectory = path.join(root, "infra/postgres/migrations");
  const enterpriseDirectory = path.join(
    root,
    "services/api-server/src/infrastructure/postgres/migrations",
  );
  const publicMigrations = readdirSync(publicDirectory)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -4))
    .sort();
  const enterpriseMigrations = readdirSync(enterpriseDirectory)
    .filter((name) => name.endsWith(".up.sql"))
    .map((name) => name.slice(0, -7))
    .sort()
    .map((id) => ({
      id,
      checksum: sha256Hex(
        `${readFileSync(path.join(enterpriseDirectory, `${id}.up.sql`), "utf8")}\0` +
        readFileSync(path.join(enterpriseDirectory, `${id}.down.sql`), "utf8"),
      ),
    }));
  return { publicMigrations, enterpriseMigrations };
}

function repositoryFile(root, value) {
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new Error("Enterprise cutover evidence must be repository-relative");
  }
  let repository;
  let file;
  try {
    repository = realpathSync(root);
    file = realpathSync(path.resolve(repository, value));
  } catch {
    throw new Error("enterprise cutover evidence cannot be read");
  }
  const relative = path.relative(repository, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Enterprise cutover evidence must be repository-relative");
  }
  return file;
}

function readFile(file, label) {
  try { return readFileSync(file, "utf8"); }
  catch { throw new Error(`${label} cannot be read`); }
}

function parseJson(value, label) {
  try { return JSON.parse(value); }
  catch { throw new Error(`${label} is not valid JSON`); }
}

function fileSha256(file) {
  if (typeof file !== "string" || !file) {
    throw new Error("Enterprise DR topology file is required");
  }
  return sha256Hex(readFile(file, "enterprise DR topology"));
}

function hmac(value, key) {
  return createHmac("sha256", key).update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left, right) {
  return left.length === right.length &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function required(value, name) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function requiredKey(value, name) {
  const result = required(value, name);
  if (result.length < 32) throw new Error(`${name} must be at least 32 characters`);
  return result;
}

function validId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,160}$/.test(value);
}

function timestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function walLsn(value) {
  return typeof value === "string" && /^[0-9A-F]+\/[0-9A-F]+$/i.test(value);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function same(left, right) {
  return stableJson(left) === stableJson(right);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
