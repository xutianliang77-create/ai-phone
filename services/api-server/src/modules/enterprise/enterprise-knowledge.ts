import { createHash } from "node:crypto";
import type {
  EnterpriseKnowledgeSearchResultDto,
  EnterpriseKnowledgeSourceDto,
  EnterpriseKnowledgeSourceType,
  EnterpriseKnowledgeVersionDto,
} from "@translation/contracts";

export type EnterpriseKnowledgeSourceRecord = EnterpriseKnowledgeSourceDto;
export type EnterpriseKnowledgeVersionRecord = EnterpriseKnowledgeVersionDto;
export type EnterpriseKnowledgeSearchResult = EnterpriseKnowledgeSearchResultDto;

export interface CreateEnterpriseKnowledgeSourceInput {
  id: string;
  name: string;
  sourceType: EnterpriseKnowledgeSourceType;
  createdAt: string;
}

export interface CreateEnterpriseKnowledgeVersionInput {
  id: string;
  sourceId: string;
  locale: string;
  countryCode: string;
  productCode: string;
  createdAt: string;
}

export interface StageEnterpriseKnowledgeChunksInput {
  versionId: string;
  expectedVersion: number;
  chunks: Array<{ blockId: string; content: string }>;
  reviewedAt: string;
}

export interface PublishEnterpriseKnowledgeVersionInput {
  versionId: string;
  expectedVersion: number;
  effectiveFrom: string;
  expiresAt?: string;
  publishedAt: string;
}

export interface SearchEnterpriseKnowledgeInput {
  query: string;
  locale: string;
  countryCode: string;
  productCode: string;
  limit: number;
  now: string;
}

export type CreateEnterpriseKnowledgeSourceResult =
  | { status: "created"; source: EnterpriseKnowledgeSourceRecord }
  | { status: "name_conflict" };

export type CreateEnterpriseKnowledgeVersionResult =
  | { status: "created"; knowledgeVersion: EnterpriseKnowledgeVersionRecord }
  | { status: "source_not_found" };

export type StageEnterpriseKnowledgeChunksResult =
  | { status: "staged"; knowledgeVersion: EnterpriseKnowledgeVersionRecord }
  | { status: "not_found" | "state_conflict" | "version_conflict" };

export type PublishEnterpriseKnowledgeVersionResult =
  | { status: "published"; knowledgeVersion: EnterpriseKnowledgeVersionRecord }
  | { status: "not_found" | "state_conflict" | "version_conflict" };

export function prepareEnterpriseKnowledgeChunks(
  chunks: StageEnterpriseKnowledgeChunksInput["chunks"],
) {
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > 200) {
    throw new Error("Enterprise knowledge chunks must contain 1 to 200 items");
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  const digest = createHash("sha256");
  const prepared = chunks.map((chunk, index) => {
    const blockId = bounded(chunk.blockId, 160, "block id");
    const content = bounded(chunk.content, 12_000, "chunk content");
    if (seen.has(blockId)) throw new Error("Duplicate enterprise knowledge block id");
    seen.add(blockId);
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > 1_000_000) {
      throw new Error("Enterprise knowledge chunk payload is too large");
    }
    const contentHash = createHash("sha256").update(content).digest("hex");
    updateLengthPrefixed(digest, blockId);
    updateLengthPrefixed(digest, content);
    return { blockId, sequence: index + 1, content, contentHash };
  });
  return { chunks: prepared, contentHash: digest.digest("hex") };
}

export function validateEnterpriseKnowledgeDimensions(input: {
  locale: string;
  countryCode: string;
  productCode: string;
}) {
  const locale = input.locale.trim();
  const countryCode = input.countryCode.trim().toUpperCase();
  const productCode = input.productCode.trim().toLowerCase();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ||
    !/^(?:ALL|[A-Z]{2})$/.test(countryCode) ||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(productCode)) {
    throw new Error("Invalid enterprise knowledge dimensions");
  }
  return { locale, countryCode, productCode };
}

export function validateEnterpriseKnowledgeSearch(input: SearchEnterpriseKnowledgeInput) {
  const dimensions = validateEnterpriseKnowledgeDimensions(input);
  const query = bounded(input.query, 500, "search query");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) {
    throw new Error("Invalid enterprise knowledge search limit");
  }
  iso(input.now, "search time");
  return { ...input, ...dimensions, query };
}

export function validateEnterpriseKnowledgePublishTime(
  input: Pick<
    PublishEnterpriseKnowledgeVersionInput,
    "effectiveFrom" | "expiresAt" | "publishedAt"
  >,
) {
  const publishedAt = iso(input.publishedAt, "published at");
  const effectiveFrom = iso(input.effectiveFrom, "effective from");
  const expiresAt = input.expiresAt ? iso(input.expiresAt, "expires at") : null;
  if (effectiveFrom < publishedAt - 300_000 ||
    expiresAt !== null && expiresAt <= effectiveFrom) {
    throw new Error("Invalid enterprise knowledge publication window");
  }
}

function bounded(value: string, maxBytes: number, field: string) {
  if (typeof value !== "string") throw new Error(`Invalid enterprise knowledge ${field}`);
  const result = value.trim();
  if (!result || Buffer.byteLength(result) > maxBytes) {
    throw new Error(`Invalid enterprise knowledge ${field}`);
  }
  return result;
}

function iso(value: string, field: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Invalid enterprise knowledge ${field}`);
  }
  return timestamp;
}

function updateLengthPrefixed(hash: ReturnType<typeof createHash>, value: string) {
  const payload = Buffer.from(value);
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(payload.byteLength);
  hash.update(length).update(payload);
}
