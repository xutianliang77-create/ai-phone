import { readFileSync } from "node:fs";

export function analyzeResult(resultPath, sample, context) {
  const rows = readResultRows(resultPath);
  const events = rows.map((row) => row.event ?? {});
  const speech = events.filter((event) => event.type === "speech");
  const finals = speech.filter((event) => event.isFinal === true);
  const errors = events.filter((event) => event.type === "error");
  const finalText = composeSpeechText(speech);
  const score = sample.language === "en"
    ? { metric: "wer", value: wordErrorRate(sample.text, finalText) }
    : { metric: "cer", value: charErrorRate(sample.text, finalText) };
  return {
    sampleId: sample.id,
    providerId: context.providerId,
    modelId: context.modelId,
    localeId: context.localeId,
    expectedText: sample.text,
    finalText,
    [score.metric]: round(score.value),
    speechEvents: speech.length,
    finalEvents: finals.length,
    errorEvents: errors.length,
    acceptable: isAcceptable(sample, finalText, score.value),
    note: noteForSample(sample, finalText),
  };
}

export function readResultRows(resultPath) {
  return readFileSync(resultPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function composeSpeechText(speechEvents) {
  const finals = speechEvents.filter((event) => event.isFinal === true);
  if (finals.length === 0) {
    return speechEvents.at(-1)?.text ?? "";
  }
  const bySegment = new Map();
  const ordered = [];
  for (const event of finals) {
    const text = String(event.text ?? "").trim();
    if (!text) continue;
    const segmentId = event.segmentId || event.id || `final-${ordered.length}`;
    if (!bySegment.has(segmentId)) ordered.push(segmentId);
    bySegment.set(segmentId, text);
  }
  return ordered
    .map((segmentId) => bySegment.get(segmentId))
    .filter(Boolean)
    .join(" ");
}

function isAcceptable(sample, finalText, score) {
  if (sample.id === "en_short_004") {
    return /a\s*[- ]?\s*120/i.test(finalText) &&
      /20,?000|twenty thousand/i.test(finalText);
  }
  return score <= 0.05;
}

function noteForSample(sample, finalText) {
  if (sample.terms?.some((term) => term === "A-120") &&
      !/a\s*[- ]?\s*120/i.test(finalText)) {
    return "保护词 A-120 丢失";
  }
  if (sample.terms?.some((term) => term === "八十八号") &&
      !/88|八十八/.test(finalText)) {
    return "地址门牌号丢失";
  }
  if (/同传/.test(sample.text) && !/同传/.test(finalText)) {
    return "领域词“同传”丢失";
  }
  return "";
}

function wordErrorRate(expected, actual) {
  return editDistance(words(expected), words(actual)) /
    Math.max(1, words(expected).length);
}

function charErrorRate(expected, actual) {
  return editDistance(chars(expected), chars(actual)) /
    Math.max(1, chars(expected).length);
}

function words(value) {
  return String(value)
    .toLowerCase()
    .replace(/a\s*[- ]?\s*120/g, "a120")
    .replace(/20,?000/g, "twenty thousand")
    .replace(/[^a-z0-9' ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function chars(value) {
  return [...String(value)
    .replace(/八十八号/g, "88号")
    .replace(/八十八/g, "88")
    .replace(/三点/g, "3点")
    .replace(/[\\s，。,.？！?!：:、-]/g, "")
    .toLowerCase()];
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  let cur = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function round(value) {
  return Number(value.toFixed(3));
}
