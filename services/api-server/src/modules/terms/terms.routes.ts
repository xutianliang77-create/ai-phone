import type { FastifyInstance } from "fastify";
import type {
  SaveTermbaseTermRequest,
  TermbaseTermDto,
  TranslationLanguageCode,
} from "@translation/contracts";
import { isTranslationLanguage } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  defaultTermbaseId,
  listActiveTerms,
  revokeTermbaseTerm,
  saveTermbaseTerm,
} from "./terms.repository.js";
import type { TermbaseTermRecord } from "./term-record.js";

export async function registerTermsRoutes(app: FastifyInstance) {
  app.get("/termbase/terms", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const query = request.query as TermQuery;
    return {
      terms: listActiveTerms({
        userId: account.id,
        termbaseId: stringValue(query.termbaseId) ?? defaultTermbaseId,
        sourceLanguage: languageValue(query.sourceLanguage),
        targetLanguage: languageValue(query.targetLanguage),
      }).map(toDto),
    };
  });

  app.post("/termbase/terms", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const body = request.body as Partial<SaveTermbaseTermRequest>;
    if (!isValidSaveTermRequest(body)) {
      return sendError(reply, 400, "invalid_termbase_term", "Invalid term");
    }
    const term = saveTermbaseTerm(account.id, body);
    if (!term) {
      return sendError(reply, 400, "invalid_termbase_term", "Invalid term");
    }
    return { term: toDto(term) };
  });

  app.delete("/termbase/terms/:termId", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { termId: string };
    const term = revokeTermbaseTerm(account.id, params.termId);
    if (!term) return sendError(reply, 404, "term_not_found", "Term not found");
    return { term: toDto(term) };
  });

  app.get("/internal/termbase/terms", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(
        reply,
        401,
        "internal_error",
        "Unauthorized internal request",
      );
    }
    const query = request.query as TermQuery;
    return {
      terms: listActiveTerms({
        userId: stringValue(query.userId) ?? "",
        termbaseId: stringValue(query.termbaseId) ?? defaultTermbaseId,
        sourceLanguage: languageValue(query.sourceLanguage),
        targetLanguage: languageValue(query.targetLanguage),
      })
        .slice(0, 20)
        .map(toDto),
    };
  });
}

interface TermQuery {
  userId?: unknown;
  termbaseId?: unknown;
  sourceLanguage?: unknown;
  targetLanguage?: unknown;
}

function isValidSaveTermRequest(
  body: Partial<SaveTermbaseTermRequest>,
): body is SaveTermbaseTermRequest {
  const sourceLanguageValid =
    body.sourceLanguage === undefined ||
    languageValue(body.sourceLanguage) !== undefined;
  const targetLanguageValid =
    body.targetLanguage === undefined ||
    languageValue(body.targetLanguage) !== undefined;
  return (
    typeof body.sourceText === "string" &&
    typeof body.translatedText === "string" &&
    sourceLanguageValid &&
    targetLanguageValid
  );
}

function toDto(term: TermbaseTermRecord): TermbaseTermDto {
  const { userId: _userId, termbaseId: _termbaseId, ...dto } = term;
  return dto;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function languageValue(value: unknown): TranslationLanguageCode | undefined {
  return typeof value === "string" && isTranslationLanguage(value)
    ? value
    : undefined;
}

function isInternalAuthorized(authorization: string | undefined) {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return authorization === `Bearer ${secret}`;
}
