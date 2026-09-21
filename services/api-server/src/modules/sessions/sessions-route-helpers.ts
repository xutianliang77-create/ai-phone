import { randomUUID } from "node:crypto";
import type {
  SaveTextTranslationSessionRequest
} from "@translation/contracts";
import { isSupportedLanguage } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  createSession
} from "./sessions-runtime.repository.js";

export function parseExportFormat(format: string | undefined) {
  if (format === "txt" || format === "json" || format === "csv") return format;
  return "markdown";
}


export function createTextTranslationSession(
  userId: string,
  body: SaveTextTranslationSessionRequest,
  sourceKind: "type_to_speak" | "scan" | "text",
) {
  const sourceText = body.sourceText.trim();
  const translatedText = body.translatedText?.trim() ?? "";
  const now = new Date().toISOString();
  return createSession({
    id: randomUUID(),
    userId,
    mode: "conversation",
    status: "ended",
    consumedSeconds: 0,
    createdAt: now,
    endedAt: now,
    segments: [
      {
        id: `${sourceKind}_1`,
        sourceText,
        translatedText,
        sourceLanguage: body.sourceLanguage ?? "auto",
        targetLanguage: body.targetLanguage ?? "auto",
        stage: "translation",
        provider: sourceKind,
        model: `${body.sourceLanguage ?? "auto"}->${body.targetLanguage ?? "auto"}`,
        providerUsage: {
          provider: sourceKind,
          model: `${body.sourceLanguage ?? "auto"}->${body.targetLanguage ?? "auto"}`,
          inputCharacters: sourceText.length,
          outputCharacters: translatedText.length,
        },
      },
    ],
  });
}


export function isValidTextTranslationBody(
  body: Partial<SaveTextTranslationSessionRequest>,
  requireTranslation: boolean,
): body is SaveTextTranslationSessionRequest {
  return (
    typeof body.sourceText === "string" &&
    body.sourceText.trim().length > 0 &&
    isOptionalText(body.translatedText) &&
    (!requireTranslation || (body.translatedText?.trim().length ?? 0) > 0) &&
    isOptionalLanguage(body.sourceLanguage) &&
    isOptionalLanguage(body.targetLanguage) &&
    isOptionalSourceKind(body.sourceKind)
  );
}


export function isOptionalText(value: unknown) {
  return value === undefined || typeof value === "string";
}


export function isOptionalSourceKind(value: unknown) {
  return (
    value === undefined ||
    value === "type_to_speak" ||
    value === "scan" ||
    value === "text"
  );
}


export function isOptionalLanguage(value: unknown) {
  return value === undefined || (typeof value === "string" && isSupportedLanguage(value));
}


export function isInternalAuthorized(authorization: string | undefined) {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return authorization === `Bearer ${secret}`;
}


export function forbidden(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    403,
    "account_forbidden",
    "Account cannot access this resource",
  );
}
