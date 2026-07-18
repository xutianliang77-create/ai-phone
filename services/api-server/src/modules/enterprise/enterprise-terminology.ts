import { createHash } from "node:crypto";
import type {
  EnterpriseRuntimeTerminologyContextDto,
  EnterpriseTermEntryDto,
  EnterpriseTerminologyPurpose,
} from "@translation/contracts";

export interface EnterpriseTermPackVersionDimensions {
  sourceLocale: string;
  targetLocale: string;
  countryCode: string;
  productCode: string;
  usageScope: EnterpriseTerminologyPurpose;
}

export interface StageEnterpriseTermPackInput {
  versionId: string;
  expectedVersion: number;
  terms: EnterpriseTermEntryDto[];
  reviewedAt: string;
}

export interface PublishEnterpriseVersionInput {
  versionId: string;
  expectedVersion: number;
  effectiveFrom: string;
  expiresAt?: string;
  publishedAt: string;
}

export interface ResolveEnterpriseTerminologyInput {
  termPackId: string;
  scriptTemplateId?: string;
  sourceLocale: string;
  targetLocale: string;
  countryCode: string;
  productCode: string;
  purpose: Exclude<EnterpriseTerminologyPurpose, "all">;
  now: string;
}

export function prepareEnterpriseTerms(terms: EnterpriseTermEntryDto[]) {
  if (!Array.isArray(terms) || terms.length < 1 || terms.length > 500) {
    throw new Error("Enterprise term pack must contain 1 to 500 terms");
  }
  const ids = new Set<string>();
  const sources = new Set<string>();
  const prepared = terms.map((term) => {
    const termId = identifier(term.termId, 80, "term id");
    const sourceText = bounded(term.sourceText, 200, "source text");
    const translatedText = bounded(term.translatedText, 500, "translated text");
    if (ids.has(termId) || sources.has(sourceText.toLocaleLowerCase())) {
      throw new Error("Duplicate enterprise term");
    }
    ids.add(termId);
    sources.add(sourceText.toLocaleLowerCase());
    const aliases = uniqueStrings(term.aliases, 10, 200, "term alias");
    const pronunciation = term.pronunciation === undefined
      ? undefined
      : bounded(term.pronunciation, 200, "pronunciation");
    if (typeof term.caseSensitive !== "boolean" || typeof term.protected !== "boolean") {
      throw new Error("Invalid enterprise term flags");
    }
    return {
      termId, sourceText, translatedText, aliases,
      ...(pronunciation ? { pronunciation } : {}),
      caseSensitive: term.caseSensitive, protected: term.protected,
    };
  });
  const serialized = JSON.stringify(prepared);
  if (Buffer.byteLength(serialized) > 1_000_000) {
    throw new Error("Enterprise term pack is too large");
  }
  return { terms: prepared, contentHash: sha256(serialized) };
}

export function validateEnterpriseTermDimensions(
  input: EnterpriseTermPackVersionDimensions,
) {
  const sourceLocale = locale(input.sourceLocale);
  const targetLocale = locale(input.targetLocale);
  const countryCode = input.countryCode.trim().toUpperCase();
  const productCode = input.productCode.trim().toLowerCase();
  if (!/^(?:ALL|[A-Z]{2})$/.test(countryCode) ||
    !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(productCode) ||
    !["all", "marketing", "support", "meeting"].includes(input.usageScope)) {
    throw new Error("Invalid enterprise term dimensions");
  }
  return { sourceLocale, targetLocale, countryCode, productCode, usageScope: input.usageScope };
}

export function validateEnterpriseVersionWindow(input: {
  effectiveFrom: string;
  expiresAt?: string;
  publishedAt: string;
}) {
  const publishedAt = iso(input.publishedAt, "published at");
  const effectiveFrom = iso(input.effectiveFrom, "effective from");
  const expiresAt = input.expiresAt ? iso(input.expiresAt, "expires at") : null;
  if (effectiveFrom < publishedAt - 300_000 ||
    expiresAt !== null && expiresAt <= effectiveFrom) {
    throw new Error("Invalid enterprise content publication window");
  }
}

export function validateEnterpriseTerminologyResolution(
  input: ResolveEnterpriseTerminologyInput,
) {
  const dimensions = validateEnterpriseTermDimensions({
    ...input, usageScope: input.purpose,
  });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.termPackId) ||
    input.scriptTemplateId !== undefined && !uuid.test(input.scriptTemplateId)) {
    throw new Error("Invalid enterprise terminology resource");
  }
  iso(input.now, "resolution time");
  return { ...input, ...dimensions, purpose: input.purpose };
}

export function createEnterpriseRuntimeContext(input: {
  termPackVersionId: string;
  termContentHash: string;
  terms: EnterpriseTermEntryDto[];
  scriptTemplateVersionId?: string;
  scriptContentHash?: string;
  script?: EnterpriseRuntimeTerminologyContextDto["script"];
}): EnterpriseRuntimeTerminologyContextDto {
  const content = JSON.stringify({
    termPackVersionId: input.termPackVersionId,
    termContentHash: input.termContentHash,
    scriptTemplateVersionId: input.scriptTemplateVersionId ?? null,
    scriptContentHash: input.scriptContentHash ?? null,
  });
  const scriptReference = input.scriptTemplateVersionId
    ? { scriptTemplateVersionId: input.scriptTemplateVersionId }
    : {};
  return {
    contextHash: sha256(content),
    termPackVersionId: input.termPackVersionId,
    ...scriptReference,
    asr: { termPackVersionId: input.termPackVersionId },
    translation: { termPackVersionId: input.termPackVersionId },
    llm: { termPackVersionId: input.termPackVersionId, ...scriptReference },
    terms: input.terms,
    ...(input.script ? { script: input.script } : {}),
  };
}

function locale(value: string) {
  const result = value.trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(result)) {
    throw new Error("Invalid enterprise locale");
  }
  return result;
}

function identifier(value: string, maxBytes: number, field: string) {
  const result = bounded(value, maxBytes, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result)) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  return result;
}

function bounded(value: string, maxBytes: number, field: string) {
  if (typeof value !== "string") throw new Error(`Invalid enterprise ${field}`);
  const result = value.trim();
  if (!result || Buffer.byteLength(result) > maxBytes) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  return result;
}

function uniqueStrings(values: string[], maxItems: number, maxBytes: number, field: string) {
  if (!Array.isArray(values) || values.length > maxItems) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  const items = values.map((value) => bounded(value, maxBytes, field));
  if (new Set(items.map((value) => value.toLocaleLowerCase())).size !== items.length) {
    throw new Error(`Duplicate enterprise ${field}`);
  }
  return items;
}

function iso(value: string, field: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`Invalid enterprise ${field}`);
  }
  return timestamp;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
