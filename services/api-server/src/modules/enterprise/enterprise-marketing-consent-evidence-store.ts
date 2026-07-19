import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EnterpriseMarketingConsentEvidenceInput } from
  "@translation/contracts";

const maximumEvidenceBytes = 25 * 1024 * 1024;
type Environment = Record<string, string | undefined>;

export type MarketingConsentEvidenceVerification =
  | { status: "verified" }
  | { status: "rejected" | "retry"; reasonCode: string };

export interface EnterpriseMarketingConsentEvidenceStore {
  readonly ready: boolean;
  readonly reasonCode?: string;
  verify(input: EnterpriseMarketingConsentEvidenceInput & {
    tenantId: string;
  }): Promise<MarketingConsentEvidenceVerification>;
  close(): void;
}

interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKey: string; secretKey: string };
  forcePathStyle: boolean;
  objectPrefix: string;
  serverSideEncryption: "AES256" | "aws:kms";
  kmsKeyId?: string;
}

export function createEnvironmentMarketingConsentEvidenceStore(
  env: Environment = process.env,
): EnterpriseMarketingConsentEvidenceStore {
  if (env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_ENABLED !== "true") {
    return unavailableStore("marketing_consent_evidence_disabled");
  }
  const localDirectory = env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_LOCAL_DIR?.trim();
  if (localDirectory) return env.NODE_ENV === "production"
    ? unavailableStore("local_marketing_consent_evidence_store_forbidden")
    : localStore(resolve(localDirectory));
  const configured = s3Config(env);
  return configured.status === "ready" ? s3Store(configured.config)
    : unavailableStore(configured.reasonCode);
}

function s3Store(config: S3Config): EnterpriseMarketingConsentEvidenceStore {
  const client = new S3Client({ region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
    ...(config.credentials ? { credentials: {
      accessKeyId: config.credentials.accessKey,
      secretAccessKey: config.credentials.secretKey,
    } } : {}) });
  return { ready: true,
    async verify(input) {
      if (!validInput(input)) return rejected("marketing_consent_evidence_invalid");
      try {
        const response = await client.send(new GetObjectCommand({
          Bucket: config.bucket, Key: objectKey(config.objectPrefix, input),
        }));
        if (!response.Body) return rejected("marketing_consent_evidence_not_found");
        const body = await bodyBuffer(response.Body as AsyncIterable<Uint8Array | string>);
        if (body.byteLength > maximumEvidenceBytes || body.byteLength !== input.sizeBytes ||
          sha256(body) !== input.sha256 || response.ContentType !== input.contentType ||
          response.Metadata?.["tenant-id"] !== input.tenantId ||
          response.Metadata?.["object-id"] !== input.objectId ||
          response.ServerSideEncryption !== config.serverSideEncryption ||
          (config.kmsKeyId && response.SSEKMSKeyId !== config.kmsKeyId)) {
          return rejected("marketing_consent_evidence_mismatch");
        }
        return { status: "verified" as const };
      } catch (error) {
        return notFound(error) ? rejected("marketing_consent_evidence_not_found")
          : { status: "retry", reasonCode: "marketing_consent_evidence_store_unavailable" };
      }
    },
    close() { client.destroy(); },
  };
}

function localStore(root: string): EnterpriseMarketingConsentEvidenceStore {
  return { ready: true,
    async verify(input) {
      if (!validInput(input)) return rejected("marketing_consent_evidence_invalid");
      try {
        const body = await readFile(localPath(root, input));
        return body.byteLength === input.sizeBytes && sha256(body) === input.sha256
          ? { status: "verified" as const }
          : rejected("marketing_consent_evidence_mismatch");
      } catch (error) {
        return (error as { code?: string }).code === "ENOENT"
          ? rejected("marketing_consent_evidence_not_found")
          : { status: "retry", reasonCode: "marketing_consent_evidence_store_unavailable" };
      }
    }, close() {},
  };
}

function unavailableStore(reasonCode: string): EnterpriseMarketingConsentEvidenceStore {
  return { ready: false, reasonCode,
    async verify() { return { status: "retry", reasonCode }; }, close() {} };
}

function s3Config(env: Environment):
  | { status: "ready"; config: S3Config }
  | { status: "invalid"; reasonCode: string } {
  const bucket = env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_S3_BUCKET?.trim();
  const region = env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_S3_REGION?.trim();
  const accessKey = env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_S3_ACCESS_KEY?.trim();
  const secretKey = env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_S3_SECRET_KEY ?? "";
  const prefix = normalizedPrefix(
    env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_OBJECT_PREFIX,
  );
  const endpoint = validEndpoint(
    env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_S3_ENDPOINT,
  );
  const encryption = env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_S3_SSE ?? "AES256";
  const kmsKeyId = env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_S3_KMS_KEY_ID?.trim();
  const credentialsValid = (!accessKey && !secretKey) ||
    Boolean(accessKey && secretKey.length >= 16);
  if (!bucket || !region || !credentialsValid || !prefix || endpoint === null ||
    !["AES256", "aws:kms"].includes(encryption) ||
    (env.NODE_ENV === "production" && endpoint?.startsWith("http:")) ||
    (encryption === "aws:kms" && !kmsKeyId)) return {
      status: "invalid", reasonCode: "marketing_consent_evidence_store_not_configured",
    };
  return { status: "ready", config: { bucket, region, objectPrefix: prefix,
    ...(accessKey ? { credentials: { accessKey, secretKey } } : {}),
    forcePathStyle:
      env.ENTERPRISE_MARKETING_CONSENT_EVIDENCE_S3_FORCE_PATH_STYLE === "true",
    serverSideEncryption: encryption as "AES256" | "aws:kms",
    ...(endpoint ? { endpoint } : {}), ...(kmsKeyId ? { kmsKeyId } : {}) } };
}

function validInput(input: EnterpriseMarketingConsentEvidenceInput & { tenantId: string }) {
  return uuid(input.tenantId) && uuid(input.objectId) && /^[a-f0-9]{64}$/.test(input.sha256) &&
    Number.isSafeInteger(input.sizeBytes) && input.sizeBytes >= 1 &&
    input.sizeBytes <= maximumEvidenceBytes && allowedContentTypes.has(input.contentType);
}
function objectKey(prefix: string, input: { tenantId: string; objectId: string }) {
  if (!uuid(input.tenantId) || !uuid(input.objectId)) throw new Error("Invalid evidence key");
  return `${prefix}/tenants/${input.tenantId}/${input.objectId}`;
}
function localPath(root: string, input: { tenantId: string; objectId: string }) {
  const file = resolve(root, objectKey("consent-evidence", input));
  if (!file.startsWith(`${root}${sep}`)) throw new Error("Invalid evidence path");
  return file;
}
async function bodyBuffer(body: AsyncIterable<Uint8Array | string>) {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of body) {
    const value = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    length += value.byteLength;
    if (length > maximumEvidenceBytes) throw new Error("Evidence too large");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
function rejected(reasonCode: string) { return { status: "rejected" as const, reasonCode }; }
function sha256(value: Buffer) { return createHash("sha256").update(value).digest("hex"); }
function uuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function normalizedPrefix(value: string | undefined) { const prefix =
  (value?.trim() || "consent-evidence").replace(/^\/+|\/+$/g, "");
  return prefix && !prefix.includes("..") ? prefix : null; }
function validEndpoint(value: string | undefined) { if (!value?.trim()) return undefined;
  try { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol)
    && !parsed.username && !parsed.password ? parsed.toString() : null; } catch { return null; } }
function notFound(error: unknown) { const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === "NoSuchKey" || value.$metadata?.httpStatusCode === 404; }
const allowedContentTypes = new Set(["application/pdf", "image/jpeg", "image/png",
  "audio/mpeg", "audio/wav", "audio/x-wav", "application/json", "text/plain"]);
