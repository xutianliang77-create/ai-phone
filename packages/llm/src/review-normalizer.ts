import { stringArray, text } from "./json.js";
import type { SessionReviewResult } from "./types.js";

export function reviewSystemPrompt() {
  return [
    "你是中英会议纪要和通信记录整理助手。",
    "只返回 JSON，不要 Markdown。",
    "严格使用字段：title, summary, decisions, actionItems, keyFacts, risks, openQuestions, highlights, terms, evidenceSegmentIds。",
    "decisions/risks/openQuestions 必须是字符串数组；actionItems 必须使用 text/owner/dueDate/priority/evidenceSegmentIds，priority 只允许 low/medium/high，未明确时省略；keyFacts/highlights 必须使用 type/text/evidenceSegmentIds；terms 必须使用 sourceText/translatedText。禁止使用 content 字段。",
    "summary 控制在 180 个中文字符以内；每条文本控制在 80 个中文字符以内；decisions/actionItems/keyFacts/risks/openQuestions/highlights/terms 各最多 3 条；evidenceSegmentIds 最多 5 个。",
    "没有明确内容的字段返回空数组，不要为了填满字段而展开细节。",
    "短字母串、编号串、车牌/订单/型号等标识符只保留原样，不要按普通英文句子评价翻译质量，也不要放入术语表。",
    "不要编造未在 segments 中出现的事实。",
  ].join("\n");
}

export function normalizeReview(value: unknown): SessionReviewResult {
  const raw = value as Record<string, unknown>;
  return {
    provider: "openai_compatible",
    generatedAt: new Date().toISOString(),
    title: text(raw.title, 120) || undefined,
    summary: text(raw.summary, 2000),
    decisions: reviewStringArray(raw.decisions, 12, 300),
    actionItems: normalizeActionItems(raw.actionItems),
    keyFacts: normalizeKeyFacts(raw.keyFacts),
    risks: reviewStringArray(raw.risks, 12, 300),
    openQuestions: reviewStringArray(raw.openQuestions, 12, 300),
    highlights: normalizeHighlights(raw.highlights),
    terms: normalizeTerms(raw.terms),
    evidenceSegmentIds: stringArray(raw.evidenceSegmentIds, 50, 80),
  };
}

function normalizeActionItems(value: unknown): SessionReviewResult["actionItems"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const raw = item as Record<string, unknown>;
    const priority = actionPriority(raw.priority);
    return {
      text: text(raw.text ?? raw.content, 300),
      owner: text(raw.owner, 80) || undefined,
      dueDate: text(raw.dueDate, 80) || undefined,
      ...(priority ? { priority } : {}),
      evidenceSegmentIds: stringArray(raw.evidenceSegmentIds, 20, 80),
    };
  }).filter((item) => item.text).slice(0, 20);
}

function actionPriority(value: unknown) {
  return ["low", "medium", "high"].includes(String(value))
    ? value as "low" | "medium" | "high"
    : undefined;
}

function normalizeKeyFacts(value: unknown): SessionReviewResult["keyFacts"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const raw = item as Record<string, unknown>;
    return {
      type: keyFactType(raw.type),
      text: text(raw.text ?? raw.content, 300),
      evidenceSegmentIds: stringArray(raw.evidenceSegmentIds, 20, 80),
    };
  }).filter((item) => item.text).slice(0, 20);
}

function normalizeHighlights(value: unknown): SessionReviewResult["highlights"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const raw = item as Record<string, unknown>;
    return { type: highlightType(raw.type), text: text(raw.text ?? raw.content, 300) };
  }).filter((item) => item.text).slice(0, 12);
}

function reviewStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return text(item, maxLength);
    const raw = item as Record<string, unknown>;
    return text(raw.text ?? raw.content, maxLength);
  }).filter(Boolean).slice(0, maxItems);
}

function normalizeTerms(value: unknown): SessionReviewResult["terms"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const raw = item as Record<string, unknown>;
    return {
      sourceText: text(raw.sourceText, 80),
      translatedText: text(raw.translatedText, 120),
    };
  }).filter((item) =>
    item.sourceText &&
    item.translatedText &&
    !isPreservedIdentifierTerm(item.sourceText, item.translatedText)
  ).slice(0, 20);
}

function isPreservedIdentifierTerm(sourceText: string, translatedText: string) {
  const source = sourceText.trim();
  const translated = translatedText.trim();
  if (source.toLowerCase() !== translated.toLowerCase()) return false;
  const tokens = source.split(/[\s,，、-]+/u).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  return tokens.every((token) => /^[A-Za-z0-9]{1,8}$/u.test(token)) &&
    tokens.filter((token) => /^[A-Za-z]$/u.test(token)).length >= Math.min(2, tokens.length);
}

function keyFactType(value: unknown): SessionReviewResult["keyFacts"][number]["type"] {
  return ["time", "money", "location", "number", "custom"].includes(String(value))
    ? value as SessionReviewResult["keyFacts"][number]["type"]
    : "custom";
}

function highlightType(value: unknown): SessionReviewResult["highlights"][number]["type"] {
  return ["time", "money", "todo", "location", "number", "custom"].includes(String(value))
    ? value as SessionReviewResult["highlights"][number]["type"]
    : "custom";
}
