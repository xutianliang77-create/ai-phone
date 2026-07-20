import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const maximumArtifactBytes = 10 * 1024 * 1024;
type Environment = Record<string, string | undefined>;

export type AuditExportArtifactWriteResult =
  | { status: "stored"; objectKey: string; sizeBytes: number; sha256: string }
  | { status: "retry" | "failed"; reasonCode: string };

export type AuditExportArtifactReadResult =
  | { status: "ready"; body: Buffer; sizeBytes: number; sha256: string }
  | { status: "not_found" | "retry"; reasonCode: string };

export type AuditExportArtifactDeleteResult =
  | { status: "converged"; outcome: "deleted" | "already_absent";
      receiptHash: string }
  | { status: "retry" | "failed"; reasonCode: string };

export interface EnterpriseAuditExportArtifactStore {
  readonly ready: boolean;
  readonly reasonCode?: string;
  put(input: {
    tenantId: string;
    exportId: string;
    content: string;
    expiresAt: string;
  }): Promise<AuditExportArtifactWriteResult>;
  get(objectKey: string): Promise<AuditExportArtifactReadResult>;
  delete(objectKey: string): Promise<AuditExportArtifactDeleteResult>;
  close(): void;
}

interface AuditExportS3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKey: string; secretKey: string };
  forcePathStyle: boolean;
  objectPrefix: string;
  serverSideEncryption: "AES256" | "aws:kms";
  kmsKeyId?: string;
}

export function createEnvironmentAuditExportArtifactStore(
  env: Environment = process.env,
): EnterpriseAuditExportArtifactStore {
  if (env.ENTERPRISE_AUDIT_EXPORT_ENABLED !== "true") {
    return unavailableStore("audit_export_disabled");
  }
  const localDirectory = env.ENTERPRISE_AUDIT_EXPORT_LOCAL_DIR?.trim();
  if (localDirectory) {
    return env.NODE_ENV === "production"
      ? unavailableStore("local_audit_export_store_forbidden")
      : localStore(resolve(localDirectory));
  }
  const configured = s3Config(env);
  return configured.status === "ready"
    ? s3Store(configured.config)
    : unavailableStore(configured.reasonCode);
}

function s3Store(config: AuditExportS3Config): EnterpriseAuditExportArtifactStore {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    ...(config.credentials ? { credentials: {
      accessKeyId: config.credentials.accessKey,
      secretAccessKey: config.credentials.secretKey,
    } } : {}),
  });
  return {
    ready: true,
    async put(input) {
      const body = Buffer.from(input.content, "utf8");
      if (body.byteLength > maximumArtifactBytes) {
        return { status: "failed", reasonCode: "audit_export_artifact_too_large" };
      }
      const objectKey = exportObjectKey(config.objectPrefix, input);
      try {
        await client.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          Body: body,
          ContentType: "application/x-ndjson",
          ServerSideEncryption: config.serverSideEncryption,
          ...(config.kmsKeyId ? { SSEKMSKeyId: config.kmsKeyId } : {}),
          Expires: new Date(input.expiresAt),
          Metadata: {
            "export-id": input.exportId,
            "tenant-id": input.tenantId,
            "sha256": sha256(body),
          },
        }));
        return stored(objectKey, body);
      } catch {
        return { status: "retry", reasonCode: "audit_export_store_unavailable" };
      }
    },
    async get(objectKey) {
      if (!validObjectKey(config.objectPrefix, objectKey)) {
        return { status: "not_found", reasonCode: "audit_export_artifact_not_found" };
      }
      try {
        const response = await client.send(new GetObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }));
        if (!response.Body) {
          return { status: "not_found", reasonCode: "audit_export_artifact_not_found" };
        }
        const body = await bodyBuffer(response.Body as AsyncIterable<Uint8Array | string>);
        return { status: "ready", body, sizeBytes: body.byteLength, sha256: sha256(body) };
      } catch (error) {
        return notFound(error)
          ? { status: "not_found", reasonCode: "audit_export_artifact_not_found" }
          : { status: "retry", reasonCode: "audit_export_store_unavailable" };
      }
    },
    async delete(objectKey) {
      if (!validObjectKey(config.objectPrefix, objectKey)) {
        return { status: "failed", reasonCode: "audit_export_artifact_key_invalid" };
      }
      try {
        const before = await s3ObjectExists(client, config.bucket, objectKey);
        if (!before) return convergedDeletion(objectKey, "already_absent");
        await client.send(new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }));
        return await s3ObjectExists(client, config.bucket, objectKey)
          ? { status: "retry", reasonCode: "audit_export_artifact_still_present" }
          : convergedDeletion(objectKey, "deleted");
      } catch {
        return { status: "retry", reasonCode: "audit_export_store_unavailable" };
      }
    },
    close() { client.destroy(); },
  };
}

function localStore(root: string): EnterpriseAuditExportArtifactStore {
  return {
    ready: true,
    async put(input) {
      const body = Buffer.from(input.content, "utf8");
      if (body.byteLength > maximumArtifactBytes) {
        return { status: "failed", reasonCode: "audit_export_artifact_too_large" };
      }
      const objectKey = exportObjectKey("audit-exports", input);
      const file = localPath(root, objectKey);
      try {
        await mkdir(dirname(file), { recursive: true });
        const temporary = `${file}.tmp`;
        await writeFile(temporary, body, { mode: 0o600 });
        await rename(temporary, file);
        return stored(objectKey, body);
      } catch {
        return { status: "retry", reasonCode: "audit_export_store_unavailable" };
      }
    },
    async get(objectKey) {
      try {
        const body = await readFile(localPath(root, objectKey));
        if (body.byteLength > maximumArtifactBytes) {
          return { status: "retry", reasonCode: "audit_export_artifact_invalid" };
        }
        return { status: "ready", body, sizeBytes: body.byteLength, sha256: sha256(body) };
      } catch (error) {
        return (error as { code?: string }).code === "ENOENT"
          ? { status: "not_found", reasonCode: "audit_export_artifact_not_found" }
          : { status: "retry", reasonCode: "audit_export_store_unavailable" };
      }
    },
    async delete(objectKey) {
      let file: string;
      try { file = localPath(root, objectKey); }
      catch {
        return { status: "failed", reasonCode: "audit_export_artifact_key_invalid" };
      }
      try {
        await stat(file);
      } catch (error) {
        return (error as { code?: string }).code === "ENOENT"
          ? convergedDeletion(objectKey, "already_absent")
          : { status: "retry", reasonCode: "audit_export_store_unavailable" };
      }
      try {
        await rm(file, { force: true });
        await stat(file);
        return { status: "retry", reasonCode: "audit_export_artifact_still_present" };
      } catch (error) {
        return (error as { code?: string }).code === "ENOENT"
          ? convergedDeletion(objectKey, "deleted")
          : { status: "retry", reasonCode: "audit_export_store_unavailable" };
      }
    },
    close() {},
  };
}

function unavailableStore(reasonCode: string): EnterpriseAuditExportArtifactStore {
  return {
    ready: false,
    reasonCode,
    async put() { return { status: "retry", reasonCode }; },
    async get() { return { status: "retry", reasonCode }; },
    async delete() { return { status: "retry", reasonCode }; },
    close() {},
  };
}

function s3Config(env: Environment):
  | { status: "ready"; config: AuditExportS3Config }
  | { status: "invalid"; reasonCode: string } {
  const bucket = env.ENTERPRISE_AUDIT_EXPORT_S3_BUCKET?.trim();
  const region = env.ENTERPRISE_AUDIT_EXPORT_S3_REGION?.trim();
  const accessKey = env.ENTERPRISE_AUDIT_EXPORT_S3_ACCESS_KEY?.trim();
  const secretKey = env.ENTERPRISE_AUDIT_EXPORT_S3_SECRET_KEY ?? "";
  const prefix = normalizedPrefix(env.ENTERPRISE_AUDIT_EXPORT_OBJECT_PREFIX);
  const endpoint = validEndpoint(env.ENTERPRISE_AUDIT_EXPORT_S3_ENDPOINT);
  const encryption = env.ENTERPRISE_AUDIT_EXPORT_S3_SSE ?? "AES256";
  const kmsKeyId = env.ENTERPRISE_AUDIT_EXPORT_S3_KMS_KEY_ID?.trim();
  const credentialsValid = (!accessKey && !secretKey) ||
    Boolean(accessKey && secretKey.length >= 16);
  if (!bucket || !region || !credentialsValid || !prefix ||
    endpoint === null || !["AES256", "aws:kms"].includes(encryption) ||
    (env.NODE_ENV === "production" && endpoint?.startsWith("http:")) ||
    (encryption === "aws:kms" && !kmsKeyId)) {
    return { status: "invalid", reasonCode: "audit_export_store_not_configured" };
  }
  return { status: "ready", config: {
    bucket, region, objectPrefix: prefix,
    ...(accessKey ? { credentials: { accessKey, secretKey } } : {}),
    forcePathStyle: env.ENTERPRISE_AUDIT_EXPORT_S3_FORCE_PATH_STYLE === "true",
    serverSideEncryption: encryption as "AES256" | "aws:kms",
    ...(endpoint ? { endpoint } : {}), ...(kmsKeyId ? { kmsKeyId } : {}),
  } };
}

function exportObjectKey(prefix: string, input: { tenantId: string; exportId: string }) {
  if (!uuid(input.tenantId) || !uuid(input.exportId)) throw new Error("Invalid audit export key");
  return `${prefix}/tenants/${input.tenantId}/${input.exportId}.jsonl`;
}
function validObjectKey(prefix: string, value: string) {
  const marker = `${prefix}/tenants/`;
  if (!value.startsWith(marker) || value.includes("..")) return false;
  const [tenantId, filename, extra] = value.slice(marker.length).split("/");
  const exportId = filename?.endsWith(".jsonl") ? filename.slice(0, -6) : "";
  return extra === undefined && uuid(tenantId ?? "") && uuid(exportId);
}
function localPath(root: string, objectKey: string) {
  if (!validObjectKey("audit-exports", objectKey)) throw new Error("Invalid local key");
  const file = resolve(root, objectKey);
  if (!file.startsWith(`${root}${sep}`)) throw new Error("Invalid local path");
  return file;
}
function stored(objectKey: string, body: Buffer) {
  return { status: "stored" as const, objectKey, sizeBytes: body.byteLength, sha256: sha256(body) };
}
function convergedDeletion(
  objectKey: string,
  outcome: "deleted" | "already_absent",
) {
  return {
    status: "converged" as const,
    outcome,
    receiptHash: sha256(Buffer.from(JSON.stringify({
      schemaVersion: 1,
      operation: "audit_export.delete",
      objectKey,
      outcome,
    }))),
  };
}
function sha256(value: Buffer) { return createHash("sha256").update(value).digest("hex"); }
function uuid(value: string) { return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function normalizedPrefix(value: string | undefined) {
  const result = (value ?? "audit-exports").replace(/^\/+|\/+$/g, "");
  return result && !result.includes("..") && /^[A-Za-z0-9/_-]+$/.test(result) ? result : null;
}
function validEndpoint(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try { const url = new URL(value.trim()); return ["http:", "https:"].includes(url.protocol) ? url.toString() : null; }
  catch { return null; }
}
function notFound(error: unknown) {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === "NoSuchKey" || value.$metadata?.httpStatusCode === 404;
}
async function s3ObjectExists(client: S3Client, bucket: string, objectKey: string) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return true;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
}
async function bodyBuffer(body: AsyncIterable<Uint8Array | string>) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of body) {
    const chunk = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
    length += chunk.byteLength;
    if (length > maximumArtifactBytes) throw new Error("Audit export artifact too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
