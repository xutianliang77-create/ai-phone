import type {
  SaveTermbaseTermRequest,
  TranslationLanguageCode,
} from "@translation/contracts";
import { stableDomainId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type { TermbaseTermRecord } from "./term-record.js";
import * as legacy from "./terms.repository.js";

export const defaultTermbaseId = legacy.defaultTermbaseId;

export async function listActiveTerms(input: {
  userId: string;
  termbaseId?: string;
  sourceLanguage?: TranslationLanguageCode;
  targetLanguage?: TranslationLanguageCode;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.listActiveTerms(input);
  const terms = await runtime.postgres.productRecords.query<TermbaseTermRecord>({
    namespace: "termbaseTerms",
    ownerId: input.userId,
    status: "active",
    limit: 500,
  });
  const termbaseId = input.termbaseId ?? defaultTermbaseId;
  return terms.filter((term) => term.termbaseId === termbaseId &&
    (!input.sourceLanguage || term.sourceLanguage === input.sourceLanguage) &&
    (!input.targetLanguage || term.targetLanguage === input.targetLanguage));
}

export async function saveTermbaseTerm(
  userId: string,
  request: SaveTermbaseTermRequest,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.saveTermbaseTerm(userId, request);
  const sourceText = cleanText(request.sourceText, 80);
  const translatedText = cleanText(request.translatedText, 120);
  if (!sourceText || !translatedText) return null;
  const sourceLanguage = request.sourceLanguage ?? detectLanguage(sourceText);
  const targetLanguage = request.targetLanguage ?? detectLanguage(translatedText);
  if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) return null;
  const termbaseId = request.termbaseId ?? defaultTermbaseId;
  const lookupKey = `${termbaseId}:${sourceText.toLowerCase()}:${targetLanguage}`;
  const existing = (await runtime.postgres.productRecords.query<TermbaseTermRecord>({
    namespace: "termbaseTerms", ownerId: userId, lookupKey, limit: 1,
  }))[0] ?? null;
  const id = existing?.id ?? stableDomainId("term", `${userId}:${lookupKey}`);
  const requestHash = repositoryRequestHash({ userId, request });
  const aggregateId = `${userId}:${termbaseId}`;
  const result = await withPostgresRepositoryFence(
    { aggregateType: "termbase", aggregateId },
    (fence) => runtime.postgres.productRecords.mutate<TermbaseTermRecord>({
      namespace: "termbaseTerms",
      recordKey: id,
      commandId: repositoryCommandId({ aggregateId, operation: `term-save:${id}`,
        version: 1, requestHash }),
      commandType: "termbase.term.save",
      requestHash,
      eventType: existing ? "termbase.term.updated" : "termbase.term.created",
      fence,
      mutate: (current) => {
        const now = new Date().toISOString();
        return {
          id, userId, termbaseId, sourceText, translatedText,
          sourceLanguage, targetLanguage, status: "active",
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        };
      },
    }),
  );
  return result.record;
}

export async function revokeTermbaseTerm(userId: string, termId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.revokeTermbaseTerm(userId, termId);
  const current = await runtime.postgres.productRecords.find<TermbaseTermRecord>(
    "termbaseTerms", termId,
  );
  if (!current || current.userId !== userId) return null;
  const requestHash = repositoryRequestHash({ userId, termId });
  const aggregateId = `${userId}:${current.termbaseId}`;
  const result = await withPostgresRepositoryFence(
    { aggregateType: "termbase", aggregateId },
    (fence) => runtime.postgres.productRecords.mutate<TermbaseTermRecord>({
      namespace: "termbaseTerms",
      recordKey: termId,
      commandId: repositoryCommandId({ aggregateId, operation: `term-revoke:${termId}`,
        version: 1, requestHash }),
      commandType: "termbase.term.revoke",
      requestHash,
      eventType: "termbase.term.revoked",
      fence,
      mutate: (record) => record && record.userId === userId
        ? { ...record, status: "revoked", updatedAt: new Date().toISOString() }
        : null,
    }),
  );
  return result.record;
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function detectLanguage(text: string): TranslationLanguageCode | null {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "en";
  return null;
}
