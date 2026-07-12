import type {
  SessionDetailResponse,
  SessionExportResponse,
  SessionListItem,
  SessionSegmentDto,
} from "@translation/contracts";
import type { SessionRecord } from "./sessions.repository.js";

export function toSessionListItem(session: SessionRecord): SessionListItem {
  return {
    sessionId: session.id,
    mode: session.mode,
    status: session.status,
    consumedSeconds: session.consumedSeconds,
    createdAt: session.createdAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    segmentCount: session.segments.length,
  };
}

export function toSessionDetail(session: SessionRecord): SessionDetailResponse {
  return {
    ...toSessionListItem(session),
    segments: session.segments,
    review: session.review ?? null,
    ...(session.diagnostics ? { diagnostics: session.diagnostics } : {}),
  };
}

export function toSessionExport(
  session: SessionRecord,
  format: "txt" | "markdown" | "json" | "csv",
): SessionExportResponse {
  if (format === "json") {
    return {
      sessionId: session.id,
      filename: `session-${session.id}.json`,
      mimeType: "application/json",
      content: JSON.stringify(toSessionDetail(session), null, 2),
    };
  }
  if (format === "csv") {
    return {
      sessionId: session.id,
      filename: `session-${session.id}.csv`,
      mimeType: "text/csv",
      content: toCsv(session),
    };
  }

  return {
    sessionId: session.id,
    filename: `session-${session.id}.${format === "markdown" ? "md" : "txt"}`,
    mimeType: format === "markdown" ? "text/markdown" : "text/plain",
    content: format === "markdown" ? toMarkdown(session) : toPlainText(session),
  };
}

function toPlainText(session: SessionRecord) {
  return session.segments
    .map((segment) => [
      ...(segment.speaker ? [`Speaker: ${speakerLabel(segment)}`] : []),
      `Original: ${segment.rawText ?? segment.sourceText}`,
      ...(segment.optimizedText ? [`Optimized: ${segment.optimizedText}`] : []),
      `Translation: ${segment.translatedText}`,
    ].join("\n"))
    .join("\n\n");
}

function toMarkdown(session: SessionRecord) {
  const lines = [
    `# Realtime Session ${session.id}`,
    "",
    `- Created: ${session.createdAt}`,
    `- Duration: ${session.consumedSeconds}s`,
    "",
  ];
  appendProviderUsage(lines, session);
  appendReview(lines, session);
  for (const segment of session.segments) {
    lines.push(`## ${segment.id}`, "");
    if (segment.speaker) lines.push(`Speaker: ${speakerLabel(segment)}`, "");
    if (segment.rawText && segment.rawText !== segment.sourceText) {
      lines.push("Raw", "", segment.rawText, "");
      lines.push("Optimized", "", segment.sourceText, "");
    } else {
      lines.push(segment.sourceText, "");
    }
    lines.push(segment.translatedText, "");
    appendSegmentDiagnostics(lines, segment);
  }
  return lines.join("\n");
}

function toCsv(session: SessionRecord) {
  const rows = [
    [
      "id",
      "sourceText",
      "rawText",
      "optimizedText",
      "translatedText",
      "sourceLanguage",
      "targetLanguage",
      "confidence",
      "stage",
      "provider",
      "model",
      "latencyMs",
      "estimatedTotalTokens",
      "speakerId",
      "speakerRole",
      "speakerName",
      "speakerSource",
      "startMs",
      "endMs",
      "endpointReason",
      "vadModelFingerprint",
      "endpointPolicyFingerprint",
      "dominantLanguage",
      "detectedLanguages",
      "mixedLanguage",
      "overlap",
      "activeSpeakerIds",
    ],
    ...session.segments.map((segment) => [
      segment.id,
      segment.sourceText,
      segment.rawText ?? "",
      segment.optimizedText ?? "",
      segment.translatedText,
      segment.sourceLanguage ?? "",
      segment.targetLanguage ?? "",
      String(segment.confidence ?? ""),
      segment.stage ?? "",
      segment.provider ?? segment.providerUsage?.provider ?? "",
      segment.model ?? segment.providerUsage?.model ?? "",
      String(segment.latencyMs ?? segment.providerUsage?.latencyMs ?? ""),
      String(segment.providerUsage?.estimatedTotalTokens ?? ""),
      segment.speaker?.speakerId ?? "",
      segment.speaker?.role ?? "",
      segment.speaker?.displayName ?? "",
      segment.speaker?.source ?? "",
      String(segment.timing?.startMs ?? ""),
      String(segment.timing?.endMs ?? ""),
      segment.vadContext?.endpointReason ?? "",
      segment.vadContext?.vadModelFingerprint ?? "",
      segment.vadContext?.endpointPolicyFingerprint ?? "",
      segment.dominantLanguage ?? "",
      segment.detectedLanguages?.join("|") ?? "",
      String(segment.mixedLanguage ?? ""),
      String(segment.timing?.overlap ?? ""),
      segment.timing?.activeSpeakerIds?.join("|") ?? "",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function speakerLabel(segment: SessionSegmentDto) {
  const speaker = segment.speaker;
  if (!speaker) return "Unknown";
  return speaker.displayName ?? speaker.speakerId;
}

function appendSegmentDiagnostics(
  lines: string[],
  segment: SessionSegmentDto,
) {
  const diagnostics: Array<[
    string,
    string | number | boolean | undefined,
  ]> = [
    ["Source language", segment.sourceLanguage],
    ["Target language", segment.targetLanguage],
    ["Dominant language", segment.dominantLanguage],
    ["Detected languages", segment.detectedLanguages?.join(", ")],
    ["Mixed language", segment.mixedLanguage],
    ["Overlapping speech", segment.timing?.overlap],
    ["Speech start", segment.timing?.startMs],
    ["Speech end", segment.timing?.endMs],
    ["Endpoint reason", segment.vadContext?.endpointReason],
    ["VAD model fingerprint", segment.vadContext?.vadModelFingerprint],
    ["Endpoint policy fingerprint", segment.vadContext?.endpointPolicyFingerprint],
    ["Confidence", segment.confidence],
    ["Stage", segment.stage],
    ["Provider", segment.provider ?? segment.providerUsage?.provider],
    ["Model", segment.model ?? segment.providerUsage?.model],
    ["Latency", formatLatency(segment)],
    ["Refinement", formatRefinement(segment)],
  ];
  const available = diagnostics.filter(([, value]) =>
    value !== undefined && value !== "");
  if (available.length === 0) return;
  lines.push("Diagnostics", "");
  for (const [label, value] of available) {
    lines.push(`- ${label}: ${value}`);
  }
  lines.push("");
}

function formatLatency(segment: SessionSegmentDto) {
  const latencyMs = segment.latencyMs ?? segment.providerUsage?.latencyMs;
  return typeof latencyMs === "number" ? `${latencyMs}ms` : undefined;
}

function formatRefinement(segment: SessionSegmentDto) {
  const refinement = segment.refinement;
  if (!refinement) return undefined;
  const model = refinement.model ? `/${refinement.model}` : "";
  const fallback = refinement.fallbackReason ? ` fallback=${refinement.fallbackReason}` : "";
  return `${refinement.provider}${model} confidence=${refinement.confidence}${fallback}`;
}

function csvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function appendReview(lines: string[], session: SessionRecord) {
  if (!session.review) return;
  if (session.review.title) lines.push("## Title", "", session.review.title, "");
  lines.push("## Summary", "", session.review.summary, "");
  appendStringList(lines, "Decisions", session.review.decisions);
  appendActionItems(lines, session.review.actionItems);
  appendKeyFacts(lines, session.review.keyFacts);
  appendStringList(lines, "Risks", session.review.risks);
  appendStringList(lines, "Open Questions", session.review.openQuestions);
  if (session.review.highlights.length > 0) {
    lines.push("## Highlights", "");
    for (const item of session.review.highlights) {
      lines.push(`- ${item.type}: ${item.text}`);
    }
    lines.push("");
  }
  if (session.review.terms.length > 0) {
    lines.push("## Terms", "");
    for (const item of session.review.terms) {
      lines.push(`- ${item.sourceText}: ${item.translatedText}`);
    }
    lines.push("");
  }
}

function appendStringList(
  lines: string[],
  title: string,
  items: string[] | undefined,
) {
  if (!items || items.length === 0) return;
  lines.push(`## ${title}`, "");
  for (const item of items) lines.push(`- ${item}`);
  lines.push("");
}

function appendActionItems(
  lines: string[],
  items: NonNullable<SessionRecord["review"]>["actionItems"],
) {
  if (!items || items.length === 0) return;
  lines.push("## Action Items", "");
  for (const item of items) {
    const owner = item.owner ? ` owner=${item.owner}` : "";
    const due = item.dueDate ? ` due=${item.dueDate}` : "";
    lines.push(`- ${item.text}${owner}${due}`);
  }
  lines.push("");
}

function appendKeyFacts(
  lines: string[],
  items: NonNullable<SessionRecord["review"]>["keyFacts"],
) {
  if (!items || items.length === 0) return;
  lines.push("## Key Facts", "");
  for (const item of items) lines.push(`- ${item.type}: ${item.text}`);
  lines.push("");
}

function appendProviderUsage(lines: string[], session: SessionRecord) {
  const usage = session.segments
    .map((segment) => ({
      provider: segment.provider ?? segment.providerUsage?.provider,
      model: segment.model ?? segment.providerUsage?.model,
      latencyMs: segment.latencyMs ?? segment.providerUsage?.latencyMs,
      estimatedTotalTokens: segment.providerUsage?.estimatedTotalTokens,
    }))
    .filter((item) => Boolean(item.provider));
  if (usage.length === 0) return;
  const totalTokens = usage.reduce(
    (sum, item) => sum + (item.estimatedTotalTokens ?? 0),
    0,
  );
  const maxLatency = usage.reduce(
    (max, item) => Math.max(max, item.latencyMs ?? 0),
    0,
  );
  const providers = [...new Set(usage.map((item) => item.provider))].join(", ");
  const models = [...new Set(usage.map((item) => item.model).filter(Boolean))].join(", ");
  lines.push(
    "## Provider Usage",
    "",
    `- Providers: ${providers}`,
    `- Models: ${models || "unknown"}`,
    `- Calls: ${usage.length}`,
    `- Estimated tokens: ${totalTokens}`,
    `- Max latency: ${maxLatency}ms`,
    "",
  );
}
