import { randomUUID } from "node:crypto";
import type {
  SaveTermbaseTermRequest,
  TranslationLanguageCode,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type { TermbaseTermRecord } from "./term-record.js";

export const defaultTermbaseId = "default";

export function listActiveTerms(input: {
  userId: string;
  termbaseId?: string;
  sourceLanguage?: TranslationLanguageCode;
  targetLanguage?: TranslationLanguageCode;
}) {
  return getStoreSnapshot().termbaseTerms
    .filter((term) => term.userId === input.userId)
    .filter((term) => term.termbaseId === (input.termbaseId ?? defaultTermbaseId))
    .filter((term) => term.status === "active")
    .filter((term) => !input.sourceLanguage || term.sourceLanguage === input.sourceLanguage)
    .filter((term) => !input.targetLanguage || term.targetLanguage === input.targetLanguage)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function saveTermbaseTerm(
  userId: string,
  request: SaveTermbaseTermRequest,
) {
  const sourceText = cleanText(request.sourceText, 80);
  const translatedText = cleanText(request.translatedText, 120);
  if (!sourceText || !translatedText) return null;
  const sourceLanguage = request.sourceLanguage ?? detectLanguage(sourceText);
  const targetLanguage = request.targetLanguage ?? detectLanguage(translatedText);
  if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) return null;

  const store = getStoreSnapshot();
  const termbaseId = request.termbaseId ?? defaultTermbaseId;
  const existing = store.termbaseTerms.find((term) =>
    term.userId === userId &&
    term.termbaseId === termbaseId &&
    term.sourceText.toLowerCase() === sourceText.toLowerCase() &&
    term.targetLanguage === targetLanguage
  );
  const now = new Date().toISOString();
  if (existing) {
    existing.translatedText = translatedText;
    existing.sourceLanguage = sourceLanguage;
    existing.status = "active";
    existing.sessionId = request.sessionId;
    existing.updatedAt = now;
    persistStoreSnapshot();
    return existing;
  }

  const term: TermbaseTermRecord = {
    id: randomUUID(),
    userId,
    termbaseId,
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
  };
  store.termbaseTerms.push(term);
  persistStoreSnapshot();
  return term;
}

export function revokeTermbaseTerm(userId: string, termId: string) {
  const term = getStoreSnapshot().termbaseTerms
    .find((item) => item.userId === userId && item.id === termId);
  if (!term) return null;
  term.status = "revoked";
  term.updatedAt = new Date().toISOString();
  persistStoreSnapshot();
  return term;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function detectLanguage(text: string): TranslationLanguageCode | null {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "en";
  return null;
}
