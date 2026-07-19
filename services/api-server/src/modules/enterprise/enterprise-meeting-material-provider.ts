import { createHash } from "node:crypto";
import {
  createLlmProvider,
  loadLlmConfig,
  type SessionReviewResult,
} from "@translation/llm";
import type {
  EnterpriseMeetingMaterialReview,
  EnterpriseMeetingMaterialSourceSegment,
} from "./enterprise-meeting-material.js";
import type { EnterpriseMeetingParticipantRecord } from "./enterprise-meeting.js";

export interface EnterpriseMeetingMaterialProvider {
  generate(input: {
    meetingId: string;
    title: string;
    segments: EnterpriseMeetingMaterialSourceSegment[];
    participants: EnterpriseMeetingParticipantRecord[];
  }): Promise<EnterpriseMeetingMaterialReview>;
}

export function createEnvironmentEnterpriseMeetingMaterialProvider(
  fetchFn: typeof fetch = fetch,
): EnterpriseMeetingMaterialProvider {
  return {
    async generate(input) {
      const config = loadLlmConfig();
      if (!config.reviewEnabled || config.provider === "off") {
        return unavailable("not_configured", "meeting_review_provider_not_configured");
      }
      try {
        const provider = createLlmProvider(config, fetchFn);
        const health = await provider.healthCheck();
        if (health.status !== "ready") {
          return unavailable("failed", "meeting_review_provider_unavailable");
        }
        const review = await provider.generateReview({
          sessionId: input.meetingId,
          titleHint: input.title,
          segments: input.segments.map((segment) => ({
            id: segment.id,
            speaker: segment.sourceDisplayName,
            sourceText: segment.sourceText,
            translatedText: segment.translations[0]?.text,
          })),
        });
        return normalizeReview(
          review,
          input.segments,
          input.participants,
          fingerprint(config.provider, config.reviewModel, review.promptVersion),
        );
      } catch {
        return unavailable("failed", "meeting_review_provider_failed");
      }
    },
  };
}

function normalizeReview(
  review: SessionReviewResult,
  segments: EnterpriseMeetingMaterialSourceSegment[],
  participants: EnterpriseMeetingParticipantRecord[],
  providerFingerprint: string,
): EnterpriseMeetingMaterialReview {
  const ids = new Set(segments.map((segment) => segment.id));
  const overall = validEvidence(review.evidenceSegmentIds, ids);
  const conclusions: EnterpriseMeetingMaterialReview["conclusions"] = [];
  add(conclusions, "summary", review.summary, overall);
  for (const value of review.decisions) add(conclusions, "decision", value, overall);
  for (const value of review.risks) add(conclusions, "risk", value, overall);
  for (const value of review.openQuestions) add(conclusions, "unresolved", value, overall);
  for (const fact of review.keyFacts) {
    add(conclusions, "topic", fact.text, validEvidence(fact.evidenceSegmentIds, ids));
  }
  const actionItems = review.actionItems.flatMap((action) => {
    const evidence = validEvidence(action.evidenceSegmentIds, ids);
    if (!action.text.trim() || evidence.length === 0) return [];
    const evidenceText = segments
      .filter((segment) => evidence.includes(segment.id))
      .flatMap((segment) => [
        segment.sourceText,
        ...segment.translations.map((translation) => translation.text),
      ]).join("\n");
    const owner = resolveOwner(action.owner, participants, evidenceText);
    const dueAt = resolveDueAt(action.dueDate, evidenceText);
    const priority = resolvePriority(action.priority, evidenceText);
    return [{
      text: action.text.trim().slice(0, 2_000),
      ...(owner ? { ownerParticipantId: owner } : {}),
      ...(dueAt ? { dueAt } : {}),
      ...(priority ? { priority } : {}),
      evidenceSourceSegmentIds: evidence,
    }];
  });
  if (conclusions.length === 0 && actionItems.length === 0) {
    return unavailable("failed", "meeting_review_evidence_invalid");
  }
  return {
    status: "ready",
    providerFingerprint,
    conclusions: conclusions.slice(0, 24),
    actionItems: actionItems.slice(0, 20),
  };
}

function add(
  target: EnterpriseMeetingMaterialReview["conclusions"],
  kind: EnterpriseMeetingMaterialReview["conclusions"][number]["kind"],
  value: string | undefined,
  evidence: string[],
) {
  const text = value?.trim();
  if (!text || evidence.length === 0) return;
  target.push({ kind, text: text.slice(0, 2_000), evidenceSourceSegmentIds: evidence });
}

function resolveOwner(
  value: string | undefined,
  participants: EnterpriseMeetingParticipantRecord[],
  evidenceText: string,
) {
  const owner = value?.trim();
  if (!owner || !evidenceText.toLocaleLowerCase().includes(owner.toLocaleLowerCase())) {
    return undefined;
  }
  const matches = participants.filter((participant) =>
    participant.displayName.trim().toLocaleLowerCase() === owner.toLocaleLowerCase()
  );
  return matches.length === 1 ? matches[0]!.id : undefined;
}

function resolveDueAt(value: string | undefined, evidenceText: string) {
  const due = value?.trim();
  if (!due || !evidenceText.includes(due)) return undefined;
  const time = Date.parse(due);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function resolvePriority(
  value: "low" | "medium" | "high" | undefined,
  evidenceText: string,
) {
  if (!value) return undefined;
  const english = new RegExp(`\\b${value}\\b`, "iu").test(evidenceText);
  const chinese = {
    low: ["低优先", "低优先级"],
    medium: ["中优先", "中优先级"],
    high: ["高优先", "高优先级"],
  }[value].some((term) => evidenceText.includes(term));
  return english || chinese ? value : undefined;
}

function validEvidence(values: string[], allowed: Set<string>) {
  return [...new Set(values)].filter((value) => allowed.has(value)).slice(0, 20);
}

function fingerprint(provider: string, model: string | undefined, prompt: string | undefined) {
  const digest = createHash("sha256").update(model ?? "unknown").digest("hex").slice(0, 16);
  const promptVersion = (prompt ?? "session_review_v2").replace(/[^A-Za-z0-9._:-]/g, "_");
  return `${provider}:${digest}:${promptVersion}`.slice(0, 200);
}

function unavailable(
  status: "not_configured" | "failed",
  reasonCode: string,
): EnterpriseMeetingMaterialReview {
  return { status, reasonCode, conclusions: [], actionItems: [] };
}
