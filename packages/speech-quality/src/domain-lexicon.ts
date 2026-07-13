import type {
  TermbaseTermDto,
  TranslationLanguageCode,
} from "@translation/contracts";
import {
  domainCorrectionPacks,
  defaultDomainPacks,
  domainTermPacks,
  type AsrCorrectionTerm,
  type DomainLexiconPack,
} from "./domain-lexicon-packs.js";

export type { AsrCorrectionTerm, DomainLexiconPack };

const now = "2026-07-10T00:00:00.000Z";

export function defaultDomainLexiconPacks() {
  return [...defaultDomainPacks];
}

export function parseDomainLexiconPacks(value: string | undefined) {
  if (!value) return defaultDomainLexiconPacks();
  const selected = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(isDomainLexiconPack);
  return selected.length > 0 ? selected : defaultDomainLexiconPacks();
}

export function domainTerminologyForPacks(
  packs: readonly DomainLexiconPack[] = defaultDomainPacks,
): TermbaseTermDto[] {
  return uniquePacks(packs).flatMap((pack) => [
    ...toTerms(`domain-${pack}`, domainTermPacks[pack]),
    ...toReverseTerms(`domain-${pack}-reverse`, domainTermPacks[pack]),
  ]);
}

export function mergeTerminologyWithDomainPacks(
  terms: TermbaseTermDto[],
  packs: readonly DomainLexiconPack[] = defaultDomainPacks,
) {
  const merged = [...terms, ...domainTerminologyForPacks(packs)];
  const seen = new Set<string>();
  return merged.filter((term) => {
    const key = [
      term.sourceLanguage,
      term.targetLanguage,
      term.sourceText.trim().toLowerCase(),
      term.translatedText.trim().toLowerCase(),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return term.status === "active";
  });
}

export function asrHotwordsForTerminology(
  terms: TermbaseTermDto[],
  corrections: AsrCorrectionTerm[] = [],
  limit = 120,
) {
  return unique([
    ...corrections.flatMap((term) => [term.toText, term.fromText]),
    ...terms.map((term) => term.sourceText),
    ...terms.map((term) => term.translatedText),
  ]).slice(0, limit);
}

export function asrCorrectionTermsForPacks(
  packs: readonly DomainLexiconPack[] = defaultDomainPacks,
  limit = 80,
) {
  return uniqueCorrections(
    uniquePacks(packs).flatMap((pack) => domainCorrectionPacks[pack]),
  ).slice(0, limit);
}

function toTerms(prefix: string, rows: Array<[string, string]>) {
  return rows.map(([sourceText, translatedText], index) =>
    term(`${prefix}-${index + 1}`, sourceText, translatedText, "zh", "en"));
}

function toReverseTerms(prefix: string, rows: Array<[string, string]>) {
  return rows.map(([translatedText, sourceText], index) =>
    term(`${prefix}-${index + 1}`, sourceText, translatedText, "en", "zh"));
}

function term(
  id: string,
  sourceText: string,
  translatedText: string,
  sourceLanguage: TranslationLanguageCode,
  targetLanguage: TranslationLanguageCode,
): TermbaseTermDto {
  return {
    id,
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function isDomainLexiconPack(value: string): value is DomainLexiconPack {
  return value in domainTermPacks;
}

function uniquePacks(packs: readonly DomainLexiconPack[]) {
  return [...new Set(packs)];
}

function uniqueCorrections(values: AsrCorrectionTerm[]) {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.fromText.toLowerCase()}|${item.toText.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
