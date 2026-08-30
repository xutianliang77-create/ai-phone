import { createHash } from "node:crypto";
import { enterpriseSupportAgentRequestHash,
  type EnterpriseSupportAgentTurnRecord } from "./enterprise-support-agent.js";
import type { EnterpriseSupportTranscriptSegment } from
  "./enterprise-support-workbench.js";
import type { EnterpriseToolExecutionRecord } from "./enterprise-support.js";

export const enterpriseSupportQualityEngineVersion = "support-quality-v1";

export interface EnterpriseSupportQualityRuleVersionRecord {
  id: string; tenantId: string; revision: number; engineVersion: string;
  locale: string; identityDisclosurePhrases: string[];
  prohibitedPromisePhrases: string[]; idempotencyKey: string;
  requestHash: string; publishedBy: string; publishedAt: string;
  createdAt: string; version: number;
}

export type EnterpriseSupportQualityFindingCode =
  "identity_disclosure_missing" | "answer_without_citation" |
  "risk_without_handoff" | "prohibited_promise" | "response_not_delivered";
export type EnterpriseSupportQualitySeverity = "critical" | "high" | "medium";

export interface EnterpriseSupportQualityFindingRecord {
  id: string; tenantId: string; reviewId: string; supportSessionId: string;
  runId: string; turnId: string; turnSequence: number;
  code: EnterpriseSupportQualityFindingCode;
  severity: EnterpriseSupportQualitySeverity; evidenceHash: string;
  createdAt: string; version: number;
}

export interface EnterpriseSupportQualityReviewRecord {
  id: string; tenantId: string; supportSessionId: string; runId: string;
  ruleVersionId: string; engineVersion: string; sourceHash: string;
  status: "complete" | "partial";
  semanticStatus: "ready" | "not_configured" | "failed";
  semanticReasonCode?: string; evaluatedTurnCount: number;
  evaluatedRuleCount: number; findingCount: number; criticalCount: number;
  highCount: number; mediumCount: number; analyzedBy: string;
  analyzedAt: string; createdAt: string; version: number;
}

export interface EnterpriseSupportQualitySessionSummary {
  review: EnterpriseSupportQualityReviewRecord;
  findingCodes: EnterpriseSupportQualityFindingCode[];
}

export interface EnterpriseSupportQualityDashboard {
  reviewCount: number; findingCount: number; criticalCount: number;
  highCount: number; mediumCount: number; disclosureMissingSessionCount: number;
  unsupportedAnswerCount: number; semanticIncorrectAnswerRate: null;
  semanticStatus: "not_configured"; semanticReasonCode: string;
  latestAnalyzedAt?: string;
}

export interface EnterpriseSupportQualityDetail {
  review: EnterpriseSupportQualityReviewRecord;
  ruleVersion: EnterpriseSupportQualityRuleVersionRecord;
  findings: EnterpriseSupportQualityFindingRecord[];
  session: { id: string; status: string; createdAt: string; updatedAt: string;
    endedAt?: string };
  run: { id: string; status: string; locale: string; generation: number };
  turns: EnterpriseSupportAgentTurnRecord[];
  transcriptSegments: EnterpriseSupportTranscriptSegment[];
  toolExecutions: EnterpriseToolExecutionRecord[];
}

export function evaluateEnterpriseSupportQuality(input: {
  tenantId: string; supportSessionId: string; runId: string; reviewId: string;
  rule: EnterpriseSupportQualityRuleVersionRecord;
  turns: EnterpriseSupportAgentTurnRecord[];
  toolExecutions: EnterpriseToolExecutionRecord[];
  createdAt: string;
}) {
  const turns = [...input.turns].sort((left, right) => left.sequence - right.sequence);
  const outputTurns = turns.filter((turn) => turn.output);
  if (outputTurns.length === 0) return null;
  const delivered = outputTurns.filter((turn) => turn.status === "delivered");
  const findings: EnterpriseSupportQualityFindingRecord[] = [];
  if (delivered.length === 0) {
    findings.push(finding(input, outputTurns[0]!, "response_not_delivered", "high"));
  } else {
    if (!containsAny(delivered[0]!.output!.spokenText,
      input.rule.identityDisclosurePhrases)) {
      findings.push(finding(input, delivered[0]!,
        "identity_disclosure_missing", "medium"));
    }
    for (const turn of delivered) {
      const output = turn.output!;
      if (["answer", "qualify"].includes(output.intent) &&
        output.knowledgeCitations.length === 0 &&
        !toolBacked(turn, input.toolExecutions, input.runId,
          input.supportSessionId)) {
        findings.push(finding(input, turn, "answer_without_citation", "high"));
      }
      if (output.riskSignals.length > 0 && output.intent !== "handoff") {
        findings.push(finding(input, turn, "risk_without_handoff", "critical"));
      }
      if (containsAny(output.spokenText, input.rule.prohibitedPromisePhrases)) {
        findings.push(finding(input, turn, "prohibited_promise", "high"));
      }
    }
  }
  return { findings, evaluatedTurnCount: delivered.length, evaluatedRuleCount: 5 };
}

function toolBacked(turn: EnterpriseSupportAgentTurnRecord,
  executions: EnterpriseToolExecutionRecord[], runId: string, sessionId: string) {
  return executions.some((execution) => {
    if (execution.sessionId !== sessionId || !execution.toolDefinitionId ||
      execution.toolRevision === undefined || !execution.argumentsHash) return false;
    const requestHash = enterpriseSupportAgentRequestHash({ runId, sessionId,
      customerId: execution.customerId,
      definitionId: execution.toolDefinitionId,
      revision: execution.toolRevision, argumentsHash: execution.argumentsHash });
    return execution.requestHash === requestHash && (
      execution.idempotencyKey === `support.tool:${turn.id}` ||
      execution.confirmationTurnId === turn.id);
  });
}

export function enterpriseSupportQualityHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function finding(input: Parameters<typeof evaluateEnterpriseSupportQuality>[0],
  turn: EnterpriseSupportAgentTurnRecord, code: EnterpriseSupportQualityFindingCode,
  severity: EnterpriseSupportQualitySeverity): EnterpriseSupportQualityFindingRecord {
  const evidenceHash = enterpriseSupportQualityHash({ turnId: turn.id,
    version: turn.version, status: turn.status, output: turn.output });
  return { id: stableUuid(`${input.reviewId}:${code}:${turn.id}`),
    tenantId: input.tenantId, reviewId: input.reviewId,
    supportSessionId: input.supportSessionId, runId: input.runId,
    turnId: turn.id, turnSequence: turn.sequence, code, severity,
    evidenceHash, createdAt: input.createdAt, version: 1 };
}
function containsAny(value: string, phrases: string[]) {
  const normalized = normalize(value);
  return phrases.some((phrase) => normalized.includes(normalize(phrase)));
}
function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(
    value as Record<string, unknown>).sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1)
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function stableSupportQualityUuid(value: string) { return stableUuid(value); }
function stableUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const item = hex.join("");
  return `${item.slice(0, 8)}-${item.slice(8, 12)}-${item.slice(12, 16)}-${
    item.slice(16, 20)}-${item.slice(20)}`;
}
