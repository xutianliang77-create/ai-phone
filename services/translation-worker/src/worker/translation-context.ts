import type {
  CallRoomTranslationLanguage,
  TermbaseTermDto,
} from "@translation/contracts";
import type {
  TranslationContextSegment,
  TranslationGlossaryTerm,
} from "./types.js";

interface StoredTranslation extends TranslationContextSegment {
  speechId?: string;
  sourceLanguage: CallRoomTranslationLanguage;
  targetLanguage: CallRoomTranslationLanguage;
}

export class CallTranslationContextStore {
  private readonly recent = new Map<string, StoredTranslation[]>();

  constructor(private readonly terminology: TermbaseTermDto[] = []) {}

  prepare(input: {
    callId: string;
    speakerRole: "host" | "guest";
    speechId?: string;
    text: string;
    sourceLanguage: CallRoomTranslationLanguage;
    targetLanguage: CallRoomTranslationLanguage;
  }) {
    const previousSegments = (this.recent.get(contextKey(input.callId, input.speakerRole)) ?? [])
      .filter((segment) =>
        (!input.speechId || segment.speechId !== input.speechId) &&
        segment.sourceLanguage === input.sourceLanguage &&
        segment.targetLanguage === input.targetLanguage
      )
      .slice(-2)
      .map(({ sourceText, translatedText }) => ({ sourceText, translatedText }));
    return {
      previousSegments,
      glossary: relevantGlossary(
        this.terminology,
        input.text,
        input.sourceLanguage,
        input.targetLanguage,
      ),
      protectedEntities: extractProtectedEntities(input.text),
    };
  }

  remember(input: {
    callId: string;
    speakerRole: "host" | "guest";
    speechId?: string;
    sourceText: string;
    translatedText: string;
    sourceLanguage: CallRoomTranslationLanguage;
    targetLanguage: CallRoomTranslationLanguage;
  }) {
    const key = contextKey(input.callId, input.speakerRole);
    const items = this.recent.get(key) ?? [];
    const existing = input.speechId
      ? items.findIndex((item) => item.speechId === input.speechId)
      : -1;
    if (existing >= 0) items[existing] = input;
    else items.push(input);
    this.recent.set(key, items.slice(-6));
  }

  clear(callId: string) {
    const prefix = `${callId}:`;
    for (const key of this.recent.keys()) {
      if (key.startsWith(prefix)) this.recent.delete(key);
    }
  }
}

export function extractProtectedEntities(text: string) {
  const patterns = [
    /\b[A-Z]{1,8}[-_]?[A-Z0-9]{1,16}\b/gu,
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu,
    /https?:\/\/[^\s]+/gu,
    /(?:USD|RMB|CNY|[$¥￥])\s*\d+(?:[.,]\d+)?/giu,
    /\+?\d[\d\s().-]{5,}\d/gu,
    /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/gu,
    /\b\d+(?:\.\d+)?(?:%|kg|km|ms|GB|MB|GHz|MHz)\b/giu,
  ];
  return unique(patterns.flatMap((pattern) => text.match(pattern) ?? [])).slice(0, 32);
}

export function stripRepeatedContextPrefix(
  translation: string,
  previousSegments: TranslationContextSegment[] = [],
) {
  let result = translation.trim();
  for (const previous of [...previousSegments].reverse()) {
    const prefix = previous.translatedText.trim();
    if (prefix.length < 4 || !result.startsWith(prefix)) continue;
    const remainder = result.slice(prefix.length).replace(/^[\s,，。.!！?？:：;-]+/u, "");
    if (remainder) result = remainder;
  }
  return result;
}

function relevantGlossary(
  terminology: TermbaseTermDto[],
  text: string,
  sourceLanguage: CallRoomTranslationLanguage,
  targetLanguage: CallRoomTranslationLanguage,
): TranslationGlossaryTerm[] {
  const normalized = text.toLocaleLowerCase();
  return terminology
    .filter((term) =>
      term.status === "active" &&
      term.sourceLanguage === sourceLanguage &&
      term.targetLanguage === targetLanguage &&
      normalized.includes(term.sourceText.toLocaleLowerCase())
    )
    .slice(0, 24)
    .map((term) => ({
      sourceText: term.sourceText,
      translatedText: term.translatedText,
    }));
}

function contextKey(callId: string, speakerRole: "host" | "guest") {
  return `${callId}:${speakerRole}`;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
