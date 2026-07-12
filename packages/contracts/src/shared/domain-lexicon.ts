export const domainLexiconPackCodes = [
  "product",
  "business",
  "technology",
  "medical",
  "travel",
  "dining",
  "entertainment",
  "cultivation",
] as const;

export type DomainLexiconPack = typeof domainLexiconPackCodes[number];

export const domainLexiconVersion = "domain-lexicon-2026-07-v1";

export function isDomainLexiconPack(value: unknown): value is DomainLexiconPack {
  return typeof value === "string" &&
    domainLexiconPackCodes.includes(value as DomainLexiconPack);
}
